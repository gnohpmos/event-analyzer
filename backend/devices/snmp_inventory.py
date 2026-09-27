"""
SNMP Inventory Discovery & Enrichment Service.
Discovers hostname, chassis model, serial number, OS family, and resolves Thailand province.
"""
import asyncio
import logging
import re
from typing import Optional, Dict, Any

from django.utils import timezone
from pysnmp.hlapi.asyncio import (
    SnmpEngine, CommunityData, UdpTransportTarget,
    ContextData, ObjectType, ObjectIdentity, getCmd, nextCmd
)

from common.settings_helper import get_setting
from devices.models import Device
from devices.province_mapping import resolve_province

logger = logging.getLogger(__name__)

# Standard OIDs
SYS_NAME_OID = '1.3.6.1.2.1.1.5.0'
SYS_DESCR_OID = '1.3.6.1.2.1.1.1.0'
ENT_PHYSICAL_MODEL_OID = '1.3.6.1.2.1.47.1.1.1.1.13'
ENT_PHYSICAL_SERIAL_OID = '1.3.6.1.2.1.47.1.1.1.1.11'


class SNMPInventoryDiscovery:
    """Discovers hardware inventory and attributes via SNMP v2c."""

    def __init__(self, default_community: Optional[str] = None):
        self._default_community = default_community

    @property
    def default_community(self) -> str:
        return self._default_community or get_setting('SNMP_COMMUNITY', 'public')

    async def _async_query_device(
        self,
        host: str,
        community: str,
        timeout: int,
        retries: int
    ) -> Dict[str, str]:
        """Pure async SNMP network query for MIB values."""
        snmp_engine = SnmpEngine()
        auth_data = CommunityData(community, mpModel=1)
        transport = UdpTransportTarget((host, 161), timeout=timeout, retries=retries)

        sys_name = ''
        sys_descr = ''
        model_name = ''
        serial_num = ''

        # 1. Query sysName & sysDescr
        try:
            err_ind, err_stat, err_idx, var_binds = await getCmd(
                snmp_engine,
                auth_data,
                transport,
                ContextData(),
                ObjectType(ObjectIdentity(SYS_NAME_OID)),
                ObjectType(ObjectIdentity(SYS_DESCR_OID)),
                lookupMib=False
            )
            if not err_ind and not err_stat and var_binds:
                for vb in var_binds:
                    oid_str = str(vb[0])
                    val_str = vb[1].prettyPrint().strip()
                    if oid_str.startswith(SYS_NAME_OID):
                        sys_name = val_str
                    elif oid_str.startswith(SYS_DESCR_OID):
                        sys_descr = val_str
        except Exception as e:
            logger.warning(f"Failed to query sysName/sysDescr for {host}: {e}")

        # If device did not respond to sysName/sysDescr, it is unreachable via SNMP
        if not sys_name and not sys_descr:
            return {
                'sys_name': '',
                'sys_descr': '',
                'model_name': '',
                'serial_num': '',
                'reachable': False
            }

        # 2. Query entPhysicalModelName via nextCmd (walk up to 20 entries)
        try:
            current_oid = ObjectIdentity(ENT_PHYSICAL_MODEL_OID)
            for _ in range(20):
                err_ind, err_stat, err_idx, var_bind_table = await nextCmd(
                    snmp_engine,
                    auth_data,
                    transport,
                    ContextData(),
                    ObjectType(current_oid),
                    lookupMib=False
                )
                if err_ind or err_stat or not var_bind_table or not var_bind_table[0]:
                    break
                vb = var_bind_table[0][0]
                oid_str = str(vb[0])
                if not oid_str.startswith(ENT_PHYSICAL_MODEL_OID):
                    break
                val_str = vb[1].prettyPrint().strip()
                if val_str and val_str.lower() not in ('none', 'unspecified', ''):
                    model_name = val_str
                    break
                current_oid = ObjectIdentity(oid_str)
        except Exception as e:
            logger.warning(f"Failed to walk entPhysicalModelName for {host}: {e}")

        # 3. Query entPhysicalSerialNum via nextCmd (walk up to 25 entries to bypass sensors)
        try:
            current_oid = ObjectIdentity(ENT_PHYSICAL_SERIAL_OID)
            for _ in range(25):
                err_ind, err_stat, err_idx, var_bind_table = await nextCmd(
                    snmp_engine,
                    auth_data,
                    transport,
                    ContextData(),
                    ObjectType(current_oid),
                    lookupMib=False
                )
                if err_ind or err_stat or not var_bind_table or not var_bind_table[0]:
                    break
                vb = var_bind_table[0][0]
                oid_str = str(vb[0])
                if not oid_str.startswith(ENT_PHYSICAL_SERIAL_OID):
                    break
                val_str = vb[1].prettyPrint().strip()
                if val_str and len(val_str) >= 5 and val_str.isalnum():
                    serial_num = val_str
                    break
                current_oid = ObjectIdentity(oid_str)
        except Exception as e:
            logger.warning(f"Failed to walk entPhysicalSerialNum for {host}: {e}")

        return {
            'sys_name': sys_name,
            'sys_descr': sys_descr,
            'model_name': model_name,
            'serial_num': serial_num,
            'reachable': True
        }

    def sync_device(
        self,
        device: Device,
        community: Optional[str] = None,
        timeout: int = 2,
        retries: int = 1
    ) -> Dict[str, Any]:
        """
        Synchronous method safe for Celery workers and views.
        Runs async SNMP probe, processes logic, and commits to DB in sync context.
        """
        target_comm = (
            community
            or device.metadata.get('snmp_community')
            or self.default_community
        )
        host = device.management_ip

        try:
            snmp_data = asyncio.run(
                self._async_query_device(host, target_comm, timeout, retries)
            )
        except Exception as e:
            logger.exception(f"SNMP_INVENTORY_RUN_ERROR for device {host}: {e}")
            return {
                'success': False,
                'error': str(e),
                'device_id': device.id,
                'ip': host
            }

        sys_name = snmp_data.get('sys_name', '')
        sys_descr = snmp_data.get('sys_descr', '')
        model_name = snmp_data.get('model_name', '')
        serial_num = snmp_data.get('serial_num', '')
        reachable = snmp_data.get('reachable', False)

        effective_name = sys_name or device.name

        # Fallback for model if ENTITY-MIB was empty: extract from sysDescr or effective_name
        if not model_name and sys_descr:
            match = re.search(r'\b(ASR-?[0-9A-Z\-]+|N540-?[0-9A-Z\-]+|NCS-?[0-9A-Z\-]+|CISCO[0-9A-Z\-]+|ME-?[0-9A-Z\-]+)\b', sys_descr, re.I)
            if match:
                model_name = match.group(1).upper()
            elif 'ASR9K' in sys_descr or 'ASR 9001' in sys_descr:
                model_name = 'ASR-9001'

        if not model_name:
            if '9001' in effective_name:
                model_name = 'ASR-9001'
            elif 'N540' in effective_name:
                model_name = 'NCS-540'
            elif '1001' in effective_name:
                model_name = 'ASR1001-X'
            elif 'A920' in effective_name or '920' in effective_name:
                model_name = 'ASR-920-12SZ-D'
            elif '7606' in effective_name:
                model_name = 'CISCO7606-S'
            elif '3600' in effective_name or '36CX' in effective_name:
                model_name = 'ME-3600X-24CX-M'

        # Resolve Thailand province from sys_name / effective_name
        prov_code, prov_name = resolve_province(effective_name)

        # Classify OS Family & RCA Strategy
        os_family = 'Unknown'
        os_version = ''
        rca_strategy = 'AUTO'

        # Decode sys_descr if returned as Hex String by PySNMP (e.g. 0x436973636f...)
        sys_descr = sys_descr.strip()
        if sys_descr.startswith('0x'):
            try:
                hex_data = sys_descr[2:].replace(' ', '').replace('\n', '').replace('\r', '')
                decoded = bytes.fromhex(hex_data).decode('utf-8', errors='ignore')
                if decoded and any(c.isprintable() for c in decoded):
                    sys_descr = decoded
            except Exception:
                pass

        # Extract clean OS Version (e.g. 5.1.3, 6.4.2, 7.7.21, 16.9.4)
        clean_version = ''
        if sys_descr:
            v_match = re.search(r'Version\s+([0-9]+(?:\.[0-9]+)+(?:[A-Za-z0-9\.\-]+)?)', sys_descr, re.I)
            if v_match:
                raw_v = v_match.group(1).strip()
                clean_version = re.split(r'[\-\[\(\:\,]', raw_v)[0].strip()
            if not clean_version:
                v_fallback = re.search(r'\b([0-9]+\.[0-9]+(?:\.[0-9]+)?)\b', sys_descr)
                if v_fallback:
                    clean_version = v_fallback.group(1).strip()
        os_version = clean_version

        descr_upper = sys_descr.upper()
        model_upper = model_name.upper()

        is_xr = (
            'IOS-XR' in descr_upper
            or 'IOS XR' in descr_upper
            or model_upper.startswith('N540')
            or model_upper.startswith('NCS')
            or 'ASR-9001' in model_upper
            or 'ASR-9006' in model_upper
            or 'ASR-9010' in model_upper
            or 'ASR-9901' in model_upper
            or 'ASR-9902' in model_upper
            or ('ASR9' in descr_upper and 'ASR920' not in descr_upper and 'ASR-920' not in descr_upper)
            or '9001' in effective_name
            or '9901' in effective_name
            or '9902' in effective_name
            or '9006' in effective_name
            or '9010' in effective_name
            or 'N540' in effective_name
            or '5501' in effective_name
            or '5001' in effective_name
        ) and not (
            'ASR-920' in model_upper
            or 'ASR920' in descr_upper
            or 'ASR1001' in model_upper
            or 'A920' in effective_name
        )

        if is_xr:
            os_family = 'IOS-XR'
            rca_strategy = 'SSH_REBOOT_HISTORY'

            # Determine whether IOS-XR is 32-bit (ver < 7.0 / ASR-9001) or 64-bit (ver >= 7.0 / NCS)
            is_xr_32bit = False
            if os_version:
                try:
                    major = int(os_version.split('.')[0])
                    if major < 7:
                        is_xr_32bit = True
                except (ValueError, IndexError):
                    pass
            if not is_xr_32bit and (
                'ASR-9001' in model_upper
                or 'ASR9001' in model_upper
                or '9001' in effective_name
                or '9006' in model_upper
                or '9006' in effective_name
                or '9010' in model_upper
                or '9010' in effective_name
                or '9901' in model_upper
                or '9901' in effective_name
                or '9902' in model_upper
                or '9902' in effective_name
            ):
                is_xr_32bit = True

            # Use SSH to collect chassis inventory (PID -> Model, SN -> Serial)
            try:
                from devices.xr_chassis_ssh import fetch_xr_chassis_ssh
                meta = device.metadata if isinstance(device.metadata, dict) else {}
                ssh_user = meta.get('ssh_username')
                ssh_pwd = meta.get('ssh_password')
                ssh_port = int(meta.get('ssh_port', 22))

                ssh_inv = fetch_xr_chassis_ssh(
                    host=host,
                    is_32bit=is_xr_32bit,
                    username=ssh_user,
                    password=ssh_pwd,
                    port=ssh_port,
                    timeout=8
                )

                if ssh_inv.get('success'):
                    if ssh_inv.get('model'):
                        model_name = ssh_inv['model']
                    if ssh_inv.get('serial'):
                        serial_num = ssh_inv['serial']
                    logger.info(
                        f"SSH_CHASSIS_OVERRIDE for {host}: model='{model_name}', sn='{serial_num}' (32bit={is_xr_32bit})"
                    )
                else:
                    logger.warning(
                        f"SSH_CHASSIS_FALLBACK for {host}: SSH failed ({ssh_inv.get('error')}), using SNMP values"
                    )
            except Exception as e:
                logger.warning(f"SSH_CHASSIS_INVOCATION_ERROR for {host}: {e}")

        elif 'IOS-XE' in descr_upper or 'IOS XE' in descr_upper or model_upper.startswith('ASR-920') or model_upper.startswith('ASR1001') or 'A920' in effective_name or '1001' in effective_name:
            os_family = 'IOS-XE'
            rca_strategy = 'SNMP_WHY_RELOAD'
        elif 'IOS' in descr_upper or model_upper.startswith('CISCO76') or model_upper.startswith('ME-3600') or model_upper.startswith('ME-3800') or '7606' in effective_name or '36CX' in effective_name:
            os_family = 'Classic IOS'
            rca_strategy = 'SNMP_WHY_RELOAD'
        else:
            os_family = 'Generic Cisco'
            rca_strategy = 'SNMP_WHY_RELOAD'

        # Synchronous DB update
        update_fields = ['os_family', 'rca_strategy', 'last_snmp_synced_at']
        device.os_family = os_family
        device.rca_strategy = rca_strategy
        device.last_snmp_synced_at = timezone.now()

        if sys_name:
            device.sys_name = sys_name
            update_fields.append('sys_name')
            if device.name == device.management_ip:
                device.name = sys_name
                update_fields.append('name')

        if prov_code:
            device.province_code = prov_code
            device.province = prov_name
            update_fields.extend(['province_code', 'province'])

        if model_name:
            device.hardware_model = model_name
            update_fields.append('hardware_model')

        if serial_num:
            device.serial_number = serial_num
            update_fields.append('serial_number')

        if os_version:
            device.os_version = os_version
            update_fields.append('os_version')

        device.save(update_fields=update_fields)

        logger.info(
            f"SNMP_DISCOVERY_SUCCESS: {host} -> sysName={sys_name}, prov={prov_code} ({prov_name}), "
            f"model={model_name}, sn={serial_num}, os={os_family}, rca={rca_strategy}"
        )

        return {
            'success': True,
            'device_id': device.id,
            'ip': host,
            'sys_name': sys_name,
            'province_code': prov_code,
            'province': prov_name,
            'hardware_model': model_name,
            'serial_number': serial_num,
            'os_family': os_family,
            'os_version': os_version,
            'rca_strategy': rca_strategy,
            'last_snmp_synced_at': device.last_snmp_synced_at.isoformat()
        }


# Singleton instance
snmp_inventory = SNMPInventoryDiscovery()

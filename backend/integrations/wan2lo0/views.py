"""
REST API Views for Wan2Loopback Topology Analysis, Live Traceroute, and Interface Traffic Loss Inspection.
"""
import logging
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .service import wan2loopback_service
from .traceroute_runner import live_traceroute_runner
from .interface_inspector import router_interface_inspector
from .segmented_oam_tracer import segmented_oam_tracer

logger = logging.getLogger(__name__)


@api_view(['POST'])
@permission_classes([AllowAny])
def analyze_topology_view(request):
    """
    POST /api/v1/integrations/wan2lo0/analyze/
    Resolves WAN IP hops into router Loopback0 topology, /30 & /31 peer interfaces,
    Mermaid flowchart syntax, and correlates active EventAnalyzer incidents.
    """
    data = request.data or {}
    mode = data.get('mode', 'general')
    ipaddr = data.get('ipaddr', '')
    ipaddr_fwd = data.get('ipaddr_fwd', '')
    ipaddr_ret = data.get('ipaddr_ret', '')
    auto_peer = bool(data.get('auto_peer', True))

    try:
        result = wan2loopback_service.analyze_paths(
            mode=mode,
            ipaddr=ipaddr,
            ipaddr_fwd=ipaddr_fwd,
            ipaddr_ret=ipaddr_ret,
            auto_peer=auto_peer,
        )
        return Response(result, status=status.HTTP_200_OK)
    except Exception as e:
        logger.exception(f"WAN2LO0_ANALYZE_VIEW_ERROR: {e}")
        return Response(
            {'error': str(e)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(['POST'])
@permission_classes([AllowAny])
def live_traceroute_view(request):
    """
    POST /api/v1/integrations/wan2lo0/live-traceroute/
    Executes a live traceroute (Router SSH or Server OS) and automatically analyzes
    the resulting hop path into full topology + Mermaid diagram + incident badges.
    """
    data = request.data or {}
    trace_type = data.get('trace_type', 'router_ssh')
    source_router_ip = (data.get('source_router_ip') or '').strip()
    target_ip = (data.get('target_ip') or '').strip()
    source_interface = (data.get('source_interface') or 'Loopback0').strip()
    auto_reverse = bool(data.get('auto_reverse', True))
    auto_peer = bool(data.get('auto_peer', True))
    max_hops = int(data.get('max_hops') or 25)

    if not target_ip:
        return Response(
            {'error': 'กรุณาระบุ Destination / Target IP'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if trace_type == 'router_ssh' and not source_router_ip:
        return Response(
            {'error': 'กรุณาระบุ Source Router IP สำหรับโหมด Router SSH Traceroute'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        result = live_traceroute_runner.run_and_analyze(
            trace_type=trace_type,
            source_router_ip=source_router_ip,
            target_ip=target_ip,
            source_interface=source_interface,
            auto_reverse=auto_reverse,
            auto_peer=auto_peer,
            max_hops=max_hops,
        )
        return Response(result, status=status.HTTP_200_OK)
    except ValueError as ve:
        return Response({'error': str(ve)}, status=status.HTTP_400_BAD_REQUEST)
    except Exception as e:
        logger.exception(f"WAN2LO0_LIVE_TRACEROUTE_VIEW_ERROR: {e}")
        return Response(
            {'error': str(e)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(['POST'])
@permission_classes([AllowAny])
def inspect_interfaces_view(request):
    """
    POST /api/v1/integrations/wan2lo0/inspect-interfaces/
    Inspects router interfaces along the traced topology across 6 dimensions of
    traffic loss (CRC/Physical Errors, Queue Drops, 3s Delta Check, Bandwidth Load %,
    Optical DOM Power dBm, and Path MTU Consistency).
    """
    data = request.data or {}
    targets = data.get('targets') or []
    measure_delta = bool(data.get('measure_delta', True))
    delta_interval_sec = float(data.get('delta_interval_sec', 15.0))

    if not isinstance(targets, list) or not targets:
        return Response(
            {'error': 'ไม่มีรายการ Interface ใน Topology สำหรับตรวจสอบ'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        result = router_interface_inspector.inspect_topology_interfaces(
            targets=targets,
            measure_delta=measure_delta,
            delta_interval_sec=delta_interval_sec,
        )
        return Response(result, status=status.HTTP_200_OK)
    except Exception as e:
        logger.exception(f"WAN2LO0_INSPECT_INTERFACES_VIEW_ERROR: {e}")
        return Response(
            {'error': str(e)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(['GET'])
@permission_classes([AllowAny])
def search_nodes_view(request):
    """
    GET /api/v1/integrations/wan2lo0/nodes/?q=<search>&limit=<limit>
    Returns matching routers from `nodeinfo` for autocomplete selection.
    """
    query = request.query_params.get('q', '')
    try:
        limit = min(200, max(1, int(request.query_params.get('limit', 50))))
    except ValueError:
        limit = 50

    nodes = wan2loopback_service.search_nodes(query=query, limit=limit)
    return Response({'nodes': nodes, 'count': len(nodes)}, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([AllowAny])
def segmented_mpls_trace_view(request):
    """
    POST /api/v1/integrations/wan2lo0/segmented-mpls-trace/
    Executes Segmented Hop-by-Hop OAM Tracing across BGP-LU domains (Unified MPLS).
    Resolves BGP-LU Next-Hops & Labels at ABRs, executes intra-domain LSP traces,
    stitches segments together, and reconstructs full topology with active incident correlation.
    """
    data = request.data or {}
    source_router_ip = (data.get('source_router_ip') or '').strip()
    target_ip = (data.get('target_ip') or '').strip()
    max_domains = int(data.get('max_domains') or 5)
    auto_peer = bool(data.get('auto_peer', True))
    auto_reverse = bool(data.get('auto_reverse', False))

    if not source_router_ip or not target_ip:
        return Response(
            {'error': 'กรุณาระบุทั้ง Source Router IP และ Target IP'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        result = segmented_oam_tracer.trace(
            source_router_ip=source_router_ip,
            target_ip=target_ip,
            max_domains=max_domains,
            auto_peer=auto_peer,
            auto_reverse=auto_reverse,
        )
        return Response(result, status=status.HTTP_200_OK)
    except ValueError as ve:
        return Response({'error': str(ve)}, status=status.HTTP_400_BAD_REQUEST)
    except Exception as e:
        logger.exception(f"WAN2LO0_SEGMENTED_MPLS_TRACE_VIEW_ERROR: {e}")
        return Response(
            {'error': str(e)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

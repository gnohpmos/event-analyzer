from rest_framework import generics, filters, status
from rest_framework.views import APIView
from rest_framework.response import Response
from django.shortcuts import get_object_or_404

from devices.models import Device
from devices.serializers import DeviceSerializer
from devices.snmp_inventory import snmp_inventory
from devices.tasks import sync_all_devices_snmp_task


class DeviceListView(generics.ListCreateAPIView):
    """List or create registered devices with filtering and search."""
    queryset = Device.objects.prefetch_related('source_mappings', 'source_mappings__source', 'incidents').all()
    serializer_class = DeviceSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = [
        'name', 'management_ip', 'device_type',
        'sys_name', 'province', 'province_code',
        'hardware_model', 'serial_number', 'os_family'
    ]
    ordering_fields = ['name', 'management_ip', 'province', 'hardware_model', 'created_at']
    ordering = ['name']


class DeviceDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Retrieve, update, or delete a single device."""
    queryset = Device.objects.prefetch_related('source_mappings', 'source_mappings__source', 'incidents').all()
    serializer_class = DeviceSerializer


class DeviceSyncSNMPView(APIView):
    """Trigger on-demand SNMP inventory sync for a specific device."""

    def post(self, request, pk):
        device = get_object_or_404(Device, pk=pk)
        result = snmp_inventory.sync_device(device)
        device.refresh_from_db()
        serializer = DeviceSerializer(device)
        return Response({
            'status': 'success' if result.get('success') else 'partial_success',
            'discovery_result': result,
            'device': serializer.data
        }, status=status.HTTP_200_OK)


class DeviceSyncAllSNMPView(APIView):
    """Trigger batch SNMP inventory sync across all registered devices."""

    def post(self, request):
        async_mode = request.data.get('async', False)
        if async_mode:
            task = sync_all_devices_snmp_task.delay()
            return Response({
                'status': 'queued',
                'task_id': task.id,
                'message': 'Batch SNMP discovery task dispatched to background worker.'
            }, status=status.HTTP_202_ACCEPTED)

        # Synchronous batch execution (up to 50 devices)
        devices = Device.objects.filter(enabled=True)
        results = []
        for dev in devices:
            res = snmp_inventory.sync_device(dev)
            results.append(res)

        return Response({
            'status': 'completed',
            'total_synced': len(results),
            'success_count': sum(1 for r in results if r.get('success')),
            'results': results
        }, status=status.HTTP_200_OK)

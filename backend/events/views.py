from rest_framework import generics, filters
from events.models import NetworkEvent, EventSource
from events.serializers import NetworkEventSerializer, EventSourceSerializer


class NetworkEventListView(generics.ListAPIView):
    """List network events with filtering."""
    serializer_class = NetworkEventSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['device__name', 'device__management_ip', 'message', 'event_type', 'event_status']
    ordering_fields = ['event_time', 'received_time', 'created_at']
    ordering = ['-event_time']

    def get_queryset(self):
        queryset = NetworkEvent.objects.select_related('source', 'device').all()
        status_param = self.request.query_params.get('status')
        type_param = self.request.query_params.get('type')
        device_id = self.request.query_params.get('device')

        if status_param:
            queryset = queryset.filter(event_status__iexact=status_param)
        if type_param:
            queryset = queryset.filter(event_type__iexact=type_param)
        if device_id:
            queryset = queryset.filter(device_id=device_id)

        return queryset


class EventSourceListView(generics.ListAPIView):
    """List registered event sources."""
    queryset = EventSource.objects.all()
    serializer_class = EventSourceSerializer

from django.urls import path
from devices.views import (
    DeviceListView, DeviceDetailView,
    DeviceSyncSNMPView, DeviceSyncAllSNMPView
)

app_name = 'devices'

urlpatterns = [
    path('', DeviceListView.as_view(), name='device-list'),
    path('sync-all-snmp/', DeviceSyncAllSNMPView.as_view(), name='device-sync-all-snmp'),
    path('<int:pk>/', DeviceDetailView.as_view(), name='device-detail'),
    path('<int:pk>/sync-snmp/', DeviceSyncSNMPView.as_view(), name='device-sync-snmp'),
]

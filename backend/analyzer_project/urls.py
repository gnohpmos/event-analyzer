from django.contrib import admin
from django.urls import path, include
from rest_framework.response import Response
from rest_framework.decorators import api_view

@api_view(['GET'])
def health_check(request):
    return Response({
        "status": "healthy",
        "service": "event-analyzer-backend",
        "version": "1.0.0"
    })

from incidents.views import DashboardSummaryView

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/health/', health_check, name='health-check'),
    # Integration routes
    path('api/v1/integrations/', include('integrations.urls')),
    # Domain entity routes
    path('api/v1/devices/', include('devices.urls')),
    path('api/v1/events/', include('events.urls')),
    path('api/v1/incidents/', include('incidents.urls')),
    path('api/v1/settings/', include('common.urls')),
    # Dashboard summary
    path('api/v1/dashboard/summary/', DashboardSummaryView.as_view(), name='dashboard-summary'),
]

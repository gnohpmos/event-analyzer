from django.urls import path
from incidents.views import (
    IncidentListView, IncidentDetailView,
    IncidentTimelineListView, IncidentVerificationsListView,
    IncidentEventsListView, DashboardSummaryView, IncidentReportView,
    IncidentSyncTicketView, IncidentTicketEligibilityView, IncidentOpenTicketView,
    IncidentOpenOSTicketView
)

app_name = 'incidents'

urlpatterns = [
    path('', IncidentListView.as_view(), name='incident-list'),
    path('report/', IncidentReportView.as_view(), name='incident-report'),
    path('<int:pk>/', IncidentDetailView.as_view(), name='incident-detail'),
    path('<int:pk>/sync-ticket/', IncidentSyncTicketView.as_view(), name='incident-sync-ticket'),
    path('<int:pk>/ticket-eligibility/', IncidentTicketEligibilityView.as_view(), name='incident-ticket-eligibility'),
    path('<int:pk>/open-ticket/', IncidentOpenTicketView.as_view(), name='incident-open-ticket'),
    path('<int:pk>/open-osticket/', IncidentOpenOSTicketView.as_view(), name='incident-open-osticket'),
    path('<int:pk>/timeline/', IncidentTimelineListView.as_view(), name='incident-timeline'),
    path('<int:pk>/verifications/', IncidentVerificationsListView.as_view(), name='incident-verifications'),
    path('<int:pk>/events/', IncidentEventsListView.as_view(), name='incident-events'),
    path('dashboard/summary/', DashboardSummaryView.as_view(), name='dashboard-summary'),
]


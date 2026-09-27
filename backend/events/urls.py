from django.urls import path
from events.views import NetworkEventListView, EventSourceListView

app_name = 'events'

urlpatterns = [
    path('', NetworkEventListView.as_view(), name='event-list'),
    path('sources/', EventSourceListView.as_view(), name='event-sources'),
]

from django.urls import path
from integrations.prtg.views import prtg_event_webhook, prtg_link_event_webhook

urlpatterns = [
    path('events/', prtg_event_webhook, name='prtg-events'),
    path('link-events/', prtg_link_event_webhook, name='prtg-link-events'),
    path('links/', prtg_link_event_webhook, name='prtg-links'),
]

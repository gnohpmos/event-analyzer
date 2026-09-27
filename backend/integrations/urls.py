from django.urls import path, include

app_name = 'integrations'

urlpatterns = [
    path('prtg/', include('integrations.prtg.urls')),
]

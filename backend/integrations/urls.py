from django.urls import path, include

app_name = 'integrations'

urlpatterns = [
    path('prtg/', include('integrations.prtg.urls')),
    path('wan2lo0/', include('integrations.wan2lo0.urls')),
]

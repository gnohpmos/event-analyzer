from django.urls import path
from .views import (
    analyze_topology_view,
    live_traceroute_view,
    inspect_interfaces_view,
    search_nodes_view,
    segmented_mpls_trace_view,
)

urlpatterns = [
    path('analyze/', analyze_topology_view, name='wan2lo0-analyze'),
    path('live-traceroute/', live_traceroute_view, name='wan2lo0-live-traceroute'),
    path('segmented-mpls-trace/', segmented_mpls_trace_view, name='wan2lo0-segmented-mpls-trace'),
    path('inspect-interfaces/', inspect_interfaces_view, name='wan2lo0-inspect-interfaces'),
    path('nodes/', search_nodes_view, name='wan2lo0-nodes'),
]

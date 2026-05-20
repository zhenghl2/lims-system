"""Organization URLs."""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import SiteViewSet, DepartmentViewSet, ReceiverViewSet

router = DefaultRouter()
router.register("sites", SiteViewSet, basename="site")
router.register("departments", DepartmentViewSet, basename="department")
router.register("receivers", ReceiverViewSet, basename="receiver")

app_name = "organizations"

urlpatterns = [
    path("", include(router.urls)),
]

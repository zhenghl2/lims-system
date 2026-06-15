"""Plasma separation URLs."""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import PlasmaSeparationBatchViewSet

router = DefaultRouter()
router.register("", PlasmaSeparationBatchViewSet, basename="plasma-separation")

app_name = "plasma_separation"

urlpatterns = [
    path("", include(router.urls)),
]

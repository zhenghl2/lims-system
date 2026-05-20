"""Sample URLs."""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import SampleViewSet, SamplePhotoViewSet, SampleTypeViewSet, TestPanelViewSet

router = DefaultRouter()
# IMPORTANT: Register specific prefixes BEFORE "" (empty) to prevent
# the DefaultRouter's greedy pk pattern from capturing them as lookups
router.register("types", SampleTypeViewSet, basename="sampletype")
router.register("panels", TestPanelViewSet, basename="testpanel")
router.register("photos", SamplePhotoViewSet, basename="samplephoto")
router.register("", SampleViewSet, basename="sample")

app_name = "samples"

urlpatterns = [
    path("", include(router.urls)),
]

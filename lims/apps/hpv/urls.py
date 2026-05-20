from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import HpvBatchViewSet, HpvResultViewSet, HpvMembranePhotoViewSet, HpvRetestViewSet

app_name = "hpv"
router = DefaultRouter()
router.register("batches", HpvBatchViewSet, basename="hpv-batch")
router.register("results", HpvResultViewSet, basename="hpv-result")
router.register("photos", HpvMembranePhotoViewSet, basename="hpv-photo")
router.register("retests", HpvRetestViewSet, basename="hpv-retest")

urlpatterns = [
    path("", include(router.urls)),
]

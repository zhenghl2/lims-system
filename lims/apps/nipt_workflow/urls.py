"""NIPT 分步批次路由（挂在 /api/v1/nipt/ 下）。"""
from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (NiptBioinformaticsViewSet, NiptExtractionViewSet,
                    NiptLibraryViewSet, NiptLineageView, NiptPendingCountsView,
                    NiptPoolingViewSet, NiptSequencingViewSet)

router = DefaultRouter()
router.register(r"extraction", NiptExtractionViewSet, basename="nipt-extraction")
router.register(r"library", NiptLibraryViewSet, basename="nipt-library")
router.register(r"pooling", NiptPoolingViewSet, basename="nipt-pooling")
router.register(r"sequencing", NiptSequencingViewSet, basename="nipt-sequencing")
router.register(r"bioinformatics", NiptBioinformaticsViewSet, basename="nipt-bioinformatics")

urlpatterns = [
    path("pending-counts/", NiptPendingCountsView.as_view(), name="nipt-pending-counts"),
    path("lineage/", NiptLineageView.as_view(), name="nipt-lineage"),
] + router.urls

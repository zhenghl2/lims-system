"""NIPT 分步批次路由（挂在 /api/v1/nipt/ 下）。"""
from rest_framework.routers import DefaultRouter

from .views import NiptExtractionViewSet, NiptLibraryViewSet

router = DefaultRouter()
router.register(r"extraction", NiptExtractionViewSet, basename="nipt-extraction")
router.register(r"library", NiptLibraryViewSet, basename="nipt-library")

urlpatterns = router.urls

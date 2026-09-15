"""Extensions URLs — 独立拓展功能 API（/api/v1/extensions/）."""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import ThaiReportBatchViewSet

app_name = "extensions"

router = DefaultRouter()
router.register(r"thai-report/batches", ThaiReportBatchViewSet, basename="thai-report-batch")

urlpatterns = [
    path("", include(router.urls)),
]

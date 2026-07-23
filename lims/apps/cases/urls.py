"""Case URLs."""
from django.urls import path, include
from rest_framework.routers import DefaultRouter, SimpleRouter
from .views import CaseViewSet, public_register, public_register_info, NipptPreProcessingViewSet, NipptExtractionViewSet

case_router = SimpleRouter()
case_router.register("", CaseViewSet, basename="case")

preprocessing_router = DefaultRouter()
preprocessing_router.include_root_view = False
preprocessing_router.register("preprocessing", NipptPreProcessingViewSet, basename="nippt-preprocessing")

extraction_router = DefaultRouter()
extraction_router.include_root_view = False
extraction_router.register("extraction", NipptExtractionViewSet, basename="nippt-extraction")

app_name = "cases"

# Module routers BEFORE case_router to avoid pk conflict
urlpatterns = (
    preprocessing_router.urls +
    extraction_router.urls +
    [path("", include(case_router.urls))]
)

urlpatterns += [
    path("public/register/<str:token>/", public_register, name="public-register"),
    path("public/info/<str:token>/", public_register_info, name="public-register-info"),
]

"""Case URLs."""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import CaseViewSet, public_register, public_register_info

router = DefaultRouter()
router.register("", CaseViewSet, basename="case")

app_name = "cases"

urlpatterns = [
    path("", include(router.urls)),
]

# Public registration endpoints
urlpatterns += [
    path("public/register/<str:token>/", public_register, name="public-register"),
    path("public/info/<str:token>/", public_register_info, name="public-register-info"),
]

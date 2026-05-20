"""URL Configuration for LIMS."""
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.views.generic import RedirectView
from rest_framework import permissions
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)

admin.site.site_header = "LIMS Administration"
admin.site.site_title = "LIMS Admin"
admin.site.index_title = "Laboratory Information Management System"

api_v1_patterns = [
    path("", include("lims.apps.users.urls", namespace="auth")),
    path("", include("lims.apps.organizations.urls", namespace="organizations")),
    path("samples/", include("lims.apps.samples.urls", namespace="samples")),
    path("runs/", include("lims.apps.workflows.urls", namespace="workflows")),
    path("reagents/", include("lims.apps.reagents.urls", namespace="reagents")),
    path("instruments/", include("lims.apps.instruments.urls", namespace="instruments")),
    path("qc/", include("lims.apps.qc.urls", namespace="qc")),
    path("bioinformatics/", include("lims.apps.bioinformatics.urls", namespace="bioinformatics")),
    path("reports/", include("lims.apps.reports.urls", namespace="reports")),
    path("documents/", include("lims.apps.documents.urls", namespace="documents")),
    path("training/", include("lims.apps.training.urls", namespace="training")),
    path("audit/", include("lims.apps.audit.urls", namespace="audit")),
    path("notifications/", include("lims.apps.notifications.urls", namespace="notifications")),
    path("quality/", include("lims.apps.quality.urls", namespace="quality")),
    path("regulatory/", include("lims.apps.regulatory.urls", namespace="regulatory")),
    path("cases/", include("lims.apps.cases.urls", namespace="cases")),
    path("hpv/", include("lims.apps.hpv.urls", namespace="hpv")),
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/", include(api_v1_patterns)),
    # API documentation
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/schema/swagger/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("api/schema/redoc/", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
    # Root redirect
    path("", RedirectView.as_view(url="/api/schema/swagger/", permanent=False)),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    try:
        import debug_toolbar
        urlpatterns += [path("__debug__/", include(debug_toolbar.urls))]
    except ImportError:
        pass

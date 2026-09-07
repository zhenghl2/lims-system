"""LIMS External API URLs (CRM2)."""
from django.urls import path

from lims.apps.lims_api.views import (
    sample_pre_receive, case_pre_receive,
    views_samples, views_cases, views_reports, views_panels,
    request_pdf_token, download_pdf,
)

app_name = "lims_api"

urlpatterns = [
    path("samples/pre-receive/", sample_pre_receive, name="pre-receive"),
    path("cases/pre-receive/", case_pre_receive, name="case-pre-receive"),
    path("views/samples/", views_samples, name="views-samples"),
    path("views/cases/", views_cases, name="views-cases"),
    path("views/reports/", views_reports, name="views-reports"),
    path("views/panels/", views_panels, name="views-panels"),
    path("views/reports/<str:uuid>/request-pdf-token/", request_pdf_token, name="pdf-token"),
    path("views/reports/<str:uuid>/pdf/", download_pdf, name="pdf-download"),
]

"""LIMS External API URLs."""
from django.urls import path
from lims.apps.lims_api.views import sample_pre_receive

app_name = "lims_api"

urlpatterns = [
    path("samples/pre-receive/", sample_pre_receive, name="pre-receive"),
]

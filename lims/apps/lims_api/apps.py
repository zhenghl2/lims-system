"""LIMS API app — external API endpoints for CRM integration."""
from django.apps import AppConfig


class LimsApiConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "lims.apps.lims_api"
    verbose_name = "LIMS External API"

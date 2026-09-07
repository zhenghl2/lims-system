from django.apps import AppConfig


class IntegrationConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "lims.apps.integration"
    verbose_name = "CRM2 Integration (webhook outbound)"

    def ready(self):
        from . import signals  # noqa: F401

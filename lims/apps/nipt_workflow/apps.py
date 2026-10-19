from django.apps import AppConfig


class NiptWorkflowConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "lims.apps.nipt_workflow"
    verbose_name = "NIPT 实验流程（分步批次）"

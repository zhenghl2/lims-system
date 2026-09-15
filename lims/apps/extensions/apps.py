"""NIPT Extensions app — 拓展功能模块（独立，与主流程无关联）."""
from django.apps import AppConfig


class ExtensionsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "lims.apps.extensions"
    verbose_name = "Extensions 拓展功能"

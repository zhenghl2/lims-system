"""Celery configuration for LIMS."""
from __future__ import absolute_import, unicode_literals
import os
from celery import Celery

# Set the default Django settings module
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "lims.config.settings.base")

app = Celery("lims")

# Using a string here means the worker doesn't have to serialize
# the configuration object to child processes.
app.config_from_object("django.conf:settings", namespace="CELERY")

# Load task modules from all registered Django app configs.
app.autodiscover_tasks()

# Configure Celery Beat schedule
app.conf.beat_schedule = {
    "create-audit-partition": {
        "task": "lims.celery_app.tasks.audit.create_monthly_partition",
        "schedule": 86400,  # daily
    },
    "check-sample-retention": {
        "task": "lims.celery_app.tasks.samples.check_retention_expirations",
        "schedule": 86400,  # daily
    },
    "check-reagent-expiry": {
        "task": "lims.celery_app.tasks.reagents.check_reagent_expirations",
        "schedule": 86400,  # daily
    },
    "verify-audit-chain": {
        "task": "lims.celery_app.tasks.audit.verify_integrity",
        "schedule": 86400,  # daily
    },
}

# Timezone
app.conf.timezone = "UTC"

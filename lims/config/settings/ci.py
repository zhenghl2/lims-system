"""CI/CD test settings."""
from .base import *  # noqa: F403

DEBUG = False
SECRET_KEY = "ci-test-key-not-for-production-use-only"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": "lims_test",
        "USER": "lims",
        "PASSWORD": "test_password",
        "HOST": "localhost",
        "PORT": "5432",
    }
}

# Use in-memory cache, don't need real Redis for tests
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
    }
}

# Skip Celery in tests
CELERY_TASK_ALWAYS_EAGER = True

# Disable S3 storage in tests
DEFAULT_FILE_STORAGE = "django.core.files.storage.FileSystemStorage"
MEDIA_ROOT = "/tmp/lims-test-media"

# Allow all hosts in CI
ALLOWED_HOSTS = ["*"]

"""CI/CD test settings — uses SQLite for speed and simplicity."""
from .base import *  # noqa: F403

DEBUG = False
SECRET_KEY = "ci-test-key-not-for-production-use-only"

# SQLite — no external database needed
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": ":memory:",
    }
}

# Use in-memory cache
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
    }
}

# Skip Celery in tests
CELERY_TASK_ALWAYS_EAGER = True

# Disable S3 storage
DEFAULT_FILE_STORAGE = "django.core.files.storage.FileSystemStorage"
MEDIA_ROOT = "/tmp/lims-test-media"

# Allow all hosts in CI
ALLOWED_HOSTS = ["*"]

"""Production settings."""
from .base import *  # noqa
import environ

env = environ.Env()

DEBUG = env("DJANGO_DEBUG", default=False)

# Security
# Disable SSL redirect for HTTP testing
SECURE_SSL_REDIRECT = False
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
SECURE_HSTS_SECONDS = 31536000  # 1 year
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True

# Trust nginx proxy headers
USE_X_FORWARDED_HOST = True
USE_X_FORWARDED_PORT = True

# Allowed hosts (override from environment)
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=[])

# Email
EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST = env("SMTP_HOST", default="")
EMAIL_PORT = env.int("SMTP_PORT", default=587)
EMAIL_USE_TLS = True
EMAIL_HOST_USER = env("SMTP_USER", default="")
EMAIL_HOST_PASSWORD = env("SMTP_PASSWORD", default="")

# CORS
CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=[])

# File storage (S3/MinIO)
DEFAULT_FILE_STORAGE = "storages.backends.s3.S3Storage"
AWS_STORAGE_BUCKET_NAME = env("AWS_STORAGE_BUCKET_NAME", default="lims-files")
AWS_S3_ENDPOINT_URL = env("AWS_S3_ENDPOINT_URL", default=None)  # MinIO URL
AWS_ACCESS_KEY_ID = env("AWS_ACCESS_KEY_ID", default="")
AWS_SECRET_ACCESS_KEY = env("AWS_SECRET_ACCESS_KEY", default="")
AWS_S3_REGION_NAME = env("AWS_S3_REGION_NAME", default="us-east-1")
AWS_S3_FILE_OVERWRITE = False
AWS_DEFAULT_ACL = "private"

# Logging
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "{levelname} {asctime} {module} {message}",
            "style": "{",
        },
    },
    "handlers": {
        "file": {
            "level": "INFO",
            "class": "logging.handlers.RotatingFileHandler",
            "filename": "/app/logs/lims.log",
            "maxBytes": 10 * 1024 * 1024,
            "backupCount": 5,
            "formatter": "verbose",
        },
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "verbose",
        },
    },
    "root": {
        "handlers": ["file", "console"],
        "level": "INFO",
    },
}


import json
import os
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

# SMTP 凭据：优先环境变量；环境变量没配时读 secrets/smtp.json（不进 git / 不进 compose）
# 2026-11-12：容器 environment 是写死在 compose 里的，改 .env 不生效；
# 用文件兜底可以免重建容器（改文件 → docker restart 即可）。
_SMTP_FILE = env("SMTP_CONFIG_FILE", default="/app/secrets/smtp.json")
_smtp_cfg = {}
try:
    if os.path.exists(_SMTP_FILE):
        with open(_SMTP_FILE, encoding="utf-8") as _fh:
            _smtp_cfg = json.load(_fh) or {}
except Exception:  # 配置坏掉不能让整站起不来
    _smtp_cfg = {}

EMAIL_HOST = env("SMTP_HOST", default="") or _smtp_cfg.get("host", "")
EMAIL_PORT = env.int("SMTP_PORT", default=int(_smtp_cfg.get("port") or 587))
# 465 = SMTPS（腾讯企业邮常用），此时必须 SSL 且不能再开 STARTTLS
EMAIL_USE_SSL = env.bool("SMTP_USE_SSL", default=bool(_smtp_cfg.get("use_ssl", EMAIL_PORT == 465)))
EMAIL_USE_TLS = env.bool("SMTP_USE_TLS", default=(not EMAIL_USE_SSL))
EMAIL_TIMEOUT = env.int("SMTP_TIMEOUT", default=20)
EMAIL_HOST_USER = env("SMTP_USER", default="") or _smtp_cfg.get("user", "")
EMAIL_HOST_PASSWORD = env("SMTP_PASSWORD", default="") or _smtp_cfg.get("password", "")
DEFAULT_FROM_EMAIL = (env("DEFAULT_FROM_EMAIL", default="")
                      or _smtp_cfg.get("from")
                      or EMAIL_HOST_USER
                      or "no-reply@localhost")

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



# ===== CRM2 Integration (added for CRM system) =====
def _env_or_file(key):
    v = os.environ.get(key, "")
    if v:
        return v
    try:
        with open("/app/.env") as _f:
            for _line in _f:
                if _line.startswith(key + "="):
                    return _line.strip().split("=", 1)[1]
    except Exception:
        pass
    return ""

LIMS_API_KEY = _env_or_file("LIMS_API_KEY")
CRM_WEBHOOK_URL = _env_or_file("CRM_WEBHOOK_URL")
CRM_WEBHOOK_KEY = _env_or_file("CRM_WEBHOOK_KEY")
INSTALLED_APPS.append("lims.apps.integration")

# 到期提醒的抄送留档（可选，配在 secrets/smtp.json 的 "bcc" 或环境变量）
REMINDER_BCC = env("REMINDER_BCC", default=_smtp_cfg.get("bcc", ""))

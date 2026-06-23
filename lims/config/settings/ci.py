"""CI/CD test settings - PostgreSQL full apps"""
from .base import *  # noqa: F403

DEBUG = False
SECRET_KEY = "smoke-test-key-2024"
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': 'lims_test',
        'USER': 'lims',
        'PASSWORD': 'test_password',
        'HOST': 'localhost',
        'PORT': '5432',
    }
}

CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}
CELERY_TASK_ALWAYS_EAGER = True
DEFAULT_FILE_STORAGE = 'django.core.files.storage.FileSystemStorage'
MEDIA_ROOT = '/tmp/lims-test-media'
ALLOWED_HOSTS = ['*']

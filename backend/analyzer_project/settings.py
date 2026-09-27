import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', 'eventanalyzer-default-secret-key-2026')
DEBUG = os.environ.get('DEBUG', 'False').lower() in ('true', '1', 'yes')

ALLOWED_HOSTS = os.environ.get('ALLOWED_HOSTS', '*').split(',')

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    # Third party apps
    'rest_framework',
    'corsheaders',
    # Core domain apps
    'common.apps.CommonConfig',
    'devices.apps.DevicesConfig',
    'events.apps.EventsConfig',
    'incidents.apps.IncidentsConfig',
    'integrations.apps.IntegrationsConfig',
    'verification.apps.VerificationConfig',
    'classification.apps.ClassificationConfig',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'analyzer_project.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'analyzer_project.wsgi.application'
ASGI_APPLICATION = 'analyzer_project.asgi.application'

# Database Configuration
POSTGRES_HOST = os.environ.get('POSTGRES_HOST', '')
if POSTGRES_HOST:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': os.environ.get('POSTGRES_DB', 'eventanalyzer_db'),
            'USER': os.environ.get('POSTGRES_USER', 'eventanalyzer_user'),
            'PASSWORD': os.environ.get('POSTGRES_PASSWORD', 'eventanalyzer_secure_pass_2026'),
            'HOST': POSTGRES_HOST,
            'PORT': os.environ.get('POSTGRES_PORT', '5432'),
        }
    }
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }
    }

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# Localization & Timezone
LANGUAGE_CODE = 'en-us'
TIME_ZONE = os.environ.get('TIME_ZONE', 'Asia/Bangkok')
USE_I18N = True
USE_TZ = True

# Static files (CSS, JavaScript, Images)
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# CORS configuration
CORS_ALLOW_ALL_ORIGINS = True
CORS_ALLOW_CREDENTIALS = True

# CSRF Trusted Origins configuration
CSRF_TRUSTED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        'CSRF_TRUSTED_ORIGINS',
        'http://localhost:8089,http://127.0.0.1:8089,http://localhost:8000,http://127.0.0.1:8000'
    ).split(',')
    if origin.strip()
]

# Reverse Proxy headers trust
USE_X_FORWARDED_HOST = True
USE_X_FORWARDED_PORT = True
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

# Django REST Framework
REST_FRAMEWORK = {
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 50,
    'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
        'rest_framework.renderers.BrowsableAPIRenderer',
    ],
    'DEFAULT_AUTHENTICATION_CLASSES': [],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.AllowAny',
    ],
}

# Celery Configuration
CELERY_BROKER_URL = os.environ.get('CELERY_BROKER_URL', 'redis://redis:6379/0')
CELERY_RESULT_BACKEND = os.environ.get('CELERY_RESULT_BACKEND', 'redis://redis:6379/0')
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TIMEZONE = TIME_ZONE

# Business Logic Configuration
ROUTER_REBOOT_THRESHOLD_SECONDS = int(os.environ.get('ROUTER_REBOOT_THRESHOLD_SECONDS', 3600))
REBOOT_TIME_TOLERANCE_SECONDS = int(os.environ.get('REBOOT_TIME_TOLERANCE_SECONDS', 300))

# SNMP Configuration
SNMP_COMMUNITY = os.environ.get('SNMP_COMMUNITY', 'public')
SNMP_VERIFY_MAX_RETRIES = int(os.environ.get('SNMP_VERIFY_MAX_RETRIES', 3))
SNMP_VERIFY_RETRY_DELAY = int(os.environ.get('SNMP_VERIFY_RETRY_DELAY', 30))
DEFAULT_SNMP_TIMEOUT = int(os.environ.get('DEFAULT_SNMP_TIMEOUT', 5))

# Integration Configuration
PRTG_ENABLED = os.environ.get('PRTG_ENABLED', 'True').lower() in ('true', '1', 'yes')
PRTG_API_TOKEN = os.environ.get('PRTG_API_TOKEN', 'prtg-secure-webhook-token-2026')

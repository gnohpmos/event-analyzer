#!/bin/sh
set -e

echo "Waiting for PostgreSQL database at ${POSTGRES_HOST:-db}:${POSTGRES_PORT:-5432}..."
python << END
import socket
import time
import os

host = os.environ.get('POSTGRES_HOST', 'db')
port = int(os.environ.get('POSTGRES_PORT', 5432))
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
connected = False
for _ in range(60):
    try:
        s.connect((host, port))
        connected = True
        break
    except socket.error:
        time.sleep(1)
s.close()
if not connected:
    print("Could not connect to PostgreSQL!")
    raise SystemExit(1)
END
echo "PostgreSQL is reachable!"

echo "Waiting for Redis at ${REDIS_HOST:-redis}:${REDIS_PORT:-6379}..."
python << END
import socket
import time
import os

host = os.environ.get('REDIS_HOST', 'redis')
port = int(os.environ.get('REDIS_PORT', 6379))
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
connected = False
for _ in range(60):
    try:
        s.connect((host, port))
        connected = True
        break
    except socket.error:
        time.sleep(1)
s.close()
if not connected:
    print("Could not connect to Redis!")
    raise SystemExit(1)
END
echo "Redis is reachable!"

echo "Applying database migrations..."
python manage.py makemigrations common devices events incidents verification --noinput || true
python manage.py migrate --noinput

echo "Collecting static files..."
python manage.py collectstatic --noinput

echo "Seeding default system settings..."
python manage.py shell -c "from common.settings_helper import seed_default_settings; seed_default_settings()" || true

echo "Starting EventAnalyzer Gunicorn server on 0.0.0.0:8000..."
exec gunicorn analyzer_project.wsgi:application \
    --bind 0.0.0.0:8000 \
    --workers 3 \
    --threads 4 \
    --timeout 600 \
    --access-logfile - \
    --error-logfile -

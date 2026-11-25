#!/bin/bash
# GlobeFrame - one-command installer for the EC2 web server (Amazon Linux 2023).
#
# Usage (inside EC2 Instance Connect, from the project folder):
#     sudo bash deploy/setup.sh
#
# Safe to run again after "git pull" to update the site. It keeps the existing
# admin account (/etc/globeframe.env), uploaded photos and photo data.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run with sudo:  sudo bash deploy/setup.sh"; exit 1
fi

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR=/opt/globeframe
DATA_DIR=/var/lib/globeframe
WEB_DIR=/var/www/html
ENV_FILE=/etc/globeframe.env

echo "==> [1/7] Installing packages (Apache, Python)"
if ! dnf install -y httpd python3.11 python3.11-pip >/dev/null 2>&1; then
  dnf install -y httpd python3 python3-pip >/dev/null
fi
PY="$(command -v python3.11 || command -v python3)"
echo "    Using $($PY --version)"

echo "==> [2/7] Creating service user and folders"
id globeframe >/dev/null 2>&1 || useradd --system --no-create-home --shell /sbin/nologin globeframe
mkdir -p "$APP_DIR" "$DATA_DIR" "$WEB_DIR/photos"
chown globeframe:globeframe "$DATA_DIR" "$WEB_DIR/photos"
chmod 755 "$WEB_DIR/photos"

echo "==> [3/7] Copying website to $WEB_DIR and backend to $APP_DIR"
cp -r "$REPO_DIR/website/." "$WEB_DIR/"
rm -rf "$APP_DIR/backend"
cp -r "$REPO_DIR/backend" "$APP_DIR/backend"

echo "==> [4/7] Installing Python packages (Flask, Gunicorn, boto3)"
[ -x "$APP_DIR/venv/bin/python" ] || "$PY" -m venv "$APP_DIR/venv"
"$APP_DIR/venv/bin/pip" install --quiet --upgrade pip
"$APP_DIR/venv/bin/pip" install --quiet -r "$APP_DIR/backend/requirements.txt"

echo "==> [5/7] Admin account and settings"
if [ -f "$ENV_FILE" ]; then
  echo "    Keeping existing settings in $ENV_FILE"
else
  ADMIN_USER="${GF_ADMIN_USER:-}"
  ADMIN_PASS="${GF_ADMIN_PASS:-}"
  if [ -z "$ADMIN_USER" ]; then
    read -rp "    Choose an admin username [admin]: " ADMIN_USER
    ADMIN_USER="${ADMIN_USER:-admin}"
  fi
  while [ -z "$ADMIN_PASS" ]; do
    read -rsp "    Choose an admin password (min 8 characters): " P1; echo
    read -rsp "    Type the password again: " P2; echo
    if [ "${#P1}" -lt 8 ]; then echo "    Too short, try again."
    elif [ "$P1" != "$P2" ]; then echo "    Passwords do not match, try again."
    else ADMIN_PASS="$P1"; fi
  done
  HASH="$(GF_P="$ADMIN_PASS" "$APP_DIR/venv/bin/python" -c \
    'import os; from werkzeug.security import generate_password_hash as g; print(g(os.environ["GF_P"]))')"
  SECRET="$("$APP_DIR/venv/bin/python" -c 'import secrets; print(secrets.token_hex(32))')"
  umask 077
  cat > "$ENV_FILE" <<EOF
# GlobeFrame settings - edit, then run: sudo systemctl restart globeframe
ADMIN_USERNAME=$ADMIN_USER
ADMIN_PASSWORD_HASH=$HASH
SECRET_KEY=$SECRET

# Where photos are stored and served from:
#   local      = on this EC2 instance (works now, no extra permissions)
#   s3         = in the S3 bucket via pre-signed links (needs the IAM role on the instance)
#   cloudfront = in the S3 bucket, delivered by CloudFront (needs the IAM role + CLOUDFRONT_DOMAIN)
IMAGE_MODE=local
S3_BUCKET=group-2-ttuu-cdn-demo-2026
AWS_REGION=ap-northeast-1
CLOUDFRONT_DOMAIN=

DATA_DIR=$DATA_DIR
LOCAL_PHOTO_DIR=$WEB_DIR/photos
MAX_UPLOAD_MB=10
EOF
  chmod 600 "$ENV_FILE"
  echo "    Saved admin account and settings to $ENV_FILE"
fi

echo "==> [6/7] Starting the GlobeFrame backend service"
cp "$REPO_DIR/deploy/globeframe.service" /etc/systemd/system/globeframe.service
systemctl daemon-reload
systemctl enable globeframe >/dev/null 2>&1
systemctl restart globeframe

echo "==> [7/7] Configuring Apache"
cp "$REPO_DIR/deploy/globeframe-apache.conf" /etc/httpd/conf.d/globeframe.conf
if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" = "Enforcing" ]; then
  setsebool -P httpd_can_network_connect 1
fi
httpd -t
systemctl enable httpd >/dev/null 2>&1
systemctl restart httpd

sleep 2
if curl -fsS http://127.0.0.1/api/health >/dev/null; then
  STATUS="OK"
else
  STATUS="NOT RESPONDING - check: sudo journalctl -u globeframe -n 50"
fi
TOKEN="$(curl -s -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' || true)"
IP="$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/public-ipv4 || true)"

echo
echo "GlobeFrame installed. Backend health check: $STATUS"
echo "  Gallery:  http://${IP:-<public-ip>}/"
echo "  Admin:    http://${IP:-<public-ip>}/admin.html"

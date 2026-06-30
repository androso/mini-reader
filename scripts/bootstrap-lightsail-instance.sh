#!/usr/bin/env bash
set -euo pipefail

READER_ROOT="${READER_ROOT:-/opt/reader}"
READER_USER="${READER_USER:-ubuntu}"
READER_GROUP="${READER_GROUP:-ubuntu}"
READER_ENV_FILE="${READER_ENV_FILE:-$READER_ROOT/.env.prod}"

require_env() {
    local name="$1"
    if [ -z "${!name:-}" ]; then
        printf 'Missing required environment variable: %s\n' "$name" >&2
        exit 1
    fi
}

for name in \
    READER_DOMAIN \
    POSTGRES_PASSWORD \
    JWT_SECRET \
    FRONTEND_URL \
    NEXT_PUBLIC_GOOGLE_CLIENT_ID \
    GOOGLE_CLIENT_ID \
    GOOGLE_CLIENT_SECRET \
    OPENAI_API_KEY \
    S3_REGION \
    S3_BUCKET_NAME \
    AWS_ACCESS_KEY_ID \
    AWS_SECRET_ACCESS_KEY; do
    require_env "$name"
done

export DEBIAN_FRONTEND=noninteractive

install -d -m 0755 /etc/apt/keyrings
apt-get update
apt-get install -y awscli ca-certificates curl debian-keyring debian-archive-keyring gettext-base git gnupg ufw

if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
fi

. /etc/os-release
cat >/etc/apt/sources.list.d/docker.list <<DOCKER_APT
deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable
DOCKER_APT

if [ ! -f /usr/share/keyrings/caddy-stable-archive-keyring.gpg ]; then
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
        | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
fi
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    >/etc/apt/sources.list.d/caddy-stable.list

apt-get update
apt-get install -y caddy containerd.io docker-buildx-plugin docker-ce docker-ce-cli docker-compose-plugin
usermod -aG docker "$READER_USER" || true

if ! swapon --show=NAME | grep -qx /swapfile; then
    if [ ! -f /swapfile ]; then
        fallocate -l 4G /swapfile
        chmod 600 /swapfile
        mkswap /swapfile
    fi
    swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab

install -d -o "$READER_USER" -g "$READER_GROUP" "$READER_ROOT/backups"

cat >"$READER_ENV_FILE" <<ENV
READER_DOMAIN=$READER_DOMAIN

POSTGRES_USER=${POSTGRES_USER:-reader}
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=${POSTGRES_DB:-reader}

JWT_SECRET=$JWT_SECRET
FRONTEND_URL=$FRONTEND_URL
API_PORT=${API_PORT:-3000}
WEB_PORT=${WEB_PORT:-3001}
NEXT_PUBLIC_API_URL=
NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID
GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET

OPENAI_API_KEY=$OPENAI_API_KEY
OPENAI_EMBEDDING_MODEL=${OPENAI_EMBEDDING_MODEL:-text-embedding-ada-002}
VECTOR_STORE_DRIVER=pg
VECTOR_STORE_BATCH_SIZE=${VECTOR_STORE_BATCH_SIZE:-25}
VECTOR_STORE_BATCH_RETRY_ATTEMPTS=${VECTOR_STORE_BATCH_RETRY_ATTEMPTS:-4}
VECTOR_STORE_BATCH_RETRY_DELAY_MS=${VECTOR_STORE_BATCH_RETRY_DELAY_MS:-1000}

STORAGE_DRIVER=s3
S3_REGION=$S3_REGION
S3_BUCKET_NAME=$S3_BUCKET_NAME
AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY

BOOK_PROCESSING_RUNNER_ENABLED=true
BOOK_PROCESSING_MAX_ATTEMPTS=${BOOK_PROCESSING_MAX_ATTEMPTS:-3}
BOOK_PROCESSING_POLL_INTERVAL_MS=${BOOK_PROCESSING_POLL_INTERVAL_MS:-2000}
BOOK_PROCESSING_RETRY_DELAY_MS=${BOOK_PROCESSING_RETRY_DELAY_MS:-5000}
BOOK_PROCESSING_STALE_LOCK_MS=${BOOK_PROCESSING_STALE_LOCK_MS:-900000}
BOOK_PROCESSING_CONCURRENCY=1

LANGFUSE_PUBLIC_KEY=${LANGFUSE_PUBLIC_KEY:-}
LANGFUSE_SECRET_KEY=${LANGFUSE_SECRET_KEY:-}
LANGFUSE_BASE_URL=${LANGFUSE_BASE_URL:-}
LANGFUSE_SAMPLE_RATE=${LANGFUSE_SAMPLE_RATE:-1}
LANGFUSE_CAPTURE_CONTENT=${LANGFUSE_CAPTURE_CONTENT:-metadata}
LANGFUSE_MAX_CAPTURE_CHARS=${LANGFUSE_MAX_CAPTURE_CHARS:-500}
ENV

chmod 600 "$READER_ENV_FILE"
chown "$READER_USER:$READER_GROUP" "$READER_ENV_FILE"

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

cd "$READER_ROOT"
docker compose --env-file "$READER_ENV_FILE" -f docker-compose.prod.yml build app
docker compose --env-file "$READER_ENV_FILE" -f docker-compose.prod.yml up -d postgres
docker compose --env-file "$READER_ENV_FILE" -f docker-compose.prod.yml run --rm app pnpm db:migrate
docker compose --env-file "$READER_ENV_FILE" -f docker-compose.prod.yml up -d

set -a
. "$READER_ENV_FILE"
set +a
envsubst < "$READER_ROOT/Caddyfile" >/etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl enable caddy
systemctl reload caddy || systemctl restart caddy

cron_file="/etc/cron.d/reader-db-backup"
cat >"$cron_file" <<CRON
15 3 * * * $READER_USER cd $READER_ROOT && ./scripts/backup-lightsail-db.sh >> $READER_ROOT/backups/backup.log 2>&1
CRON
chmod 0644 "$cron_file"

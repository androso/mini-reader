#!/usr/bin/env bash
set -euo pipefail

if [ -z "${READER_BOOTSTRAP_LOG_ACTIVE:-}" ]; then
    export READER_BOOTSTRAP_LOG_ACTIVE=1
    exec > >(tee -a /var/log/reader-bootstrap.log) 2>&1
fi

echo "Reader host bootstrap started at $(date -Is)"

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
    OPENAI_API_KEY \
    S3_REGION \
    S3_BUCKET_NAME \
    AWS_ACCESS_KEY_ID \
    AWS_SECRET_ACCESS_KEY; do
    require_env "$name"
done

export DEBIAN_FRONTEND=noninteractive

install -d -m 0755 /etc/apt/keyrings
apt-get update -o Acquire::Retries=5
apt-get install -y ca-certificates curl debian-keyring debian-archive-keyring git gnupg unzip

if ! command -v aws >/dev/null 2>&1; then
    aws_cli_arch="$(uname -m)"
    case "$aws_cli_arch" in
        x86_64) aws_cli_arch="x86_64" ;;
        aarch64 | arm64) aws_cli_arch="aarch64" ;;
        *)
            printf 'Unsupported architecture for AWS CLI install: %s\n' "$aws_cli_arch" >&2
            exit 1
            ;;
    esac
    aws_cli_tmp="$(mktemp -d)"
    curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${aws_cli_arch}.zip" \
        -o "$aws_cli_tmp/awscliv2.zip"
    unzip -q "$aws_cli_tmp/awscliv2.zip" -d "$aws_cli_tmp"
    "$aws_cli_tmp/aws/install" --update
    rm -rf "$aws_cli_tmp"
fi

if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
fi

. /etc/os-release
cat >/etc/apt/sources.list.d/docker.list <<DOCKER_APT
deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable
DOCKER_APT

apt-get update -o Acquire::Retries=5
apt-get install -y containerd.io docker-buildx-plugin docker-ce docker-ce-cli docker-compose-plugin
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
NEXT_PUBLIC_API_URL=
NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID
GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID

OPENAI_API_KEY=$OPENAI_API_KEY
OPENAI_EMBEDDING_MODEL=${OPENAI_EMBEDDING_MODEL:-text-embedding-ada-002}
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

LANGFUSE_PUBLIC_KEY=${LANGFUSE_PUBLIC_KEY:-}
LANGFUSE_SECRET_KEY=${LANGFUSE_SECRET_KEY:-}
LANGFUSE_BASE_URL=${LANGFUSE_BASE_URL:-}
LANGFUSE_SAMPLE_RATE=${LANGFUSE_SAMPLE_RATE:-1}
LANGFUSE_CAPTURE_CONTENT=${LANGFUSE_CAPTURE_CONTENT:-metadata}
LANGFUSE_MAX_CAPTURE_CHARS=${LANGFUSE_MAX_CAPTURE_CHARS:-500}
ENV

chmod 600 "$READER_ENV_FILE"
chown "$READER_USER:$READER_GROUP" "$READER_ENV_FILE"

cron_file="/etc/cron.d/reader-db-backup"
cat >"$cron_file" <<CRON
15 3 * * * $READER_USER cd $READER_ROOT && ./scripts/backup-lightsail-db.sh >> $READER_ROOT/backups/backup.log 2>&1
CRON
chmod 0644 "$cron_file"

cd "$READER_ROOT"
docker compose --env-file "$READER_ENV_FILE" -f docker-compose.prod.yml config >/dev/null
docker compose --env-file "$READER_ENV_FILE" -f docker-compose.prod.yml build app
docker compose --env-file "$READER_ENV_FILE" -f docker-compose.prod.yml up -d --wait postgres
docker compose --env-file "$READER_ENV_FILE" -f docker-compose.prod.yml run --rm app pnpm db:migrate
docker compose --env-file "$READER_ENV_FILE" -f docker-compose.prod.yml run --rm app pnpm --filter @reader/api metadata:backfill

if systemctl list-unit-files 2>/dev/null | grep -q '^caddy\.service'; then
    echo "Disabling host caddy.service..."
    systemctl stop caddy.service || true
    systemctl disable caddy.service || true
fi

if ss -tlnp 2>/dev/null | grep -E ':(80|443)\b' | grep -qv 'docker'; then
    echo "ERROR: Port 80 or 443 is occupied by a non-Docker host process after disabling caddy.service." >&2
    exit 1
fi

docker compose --env-file "$READER_ENV_FILE" -f docker-compose.prod.yml up -d --wait

echo "Reader host bootstrap finished at $(date -Is)"

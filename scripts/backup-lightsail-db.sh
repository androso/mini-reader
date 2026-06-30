#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/reader/backups}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.prod}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_NAME="reader-db-${TIMESTAMP}.sql.gz"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_NAME}"

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

mkdir -p "$BACKUP_DIR"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
    pg_dump -U "${POSTGRES_USER:-reader}" "${POSTGRES_DB:-reader}" \
    | gzip > "$BACKUP_PATH"

echo "Wrote ${BACKUP_PATH}"

if [ "${UPLOAD_BACKUP_TO_S3:-true}" = "true" ]; then
    if [ -z "${S3_BUCKET_NAME:-}" ]; then
        echo "S3_BUCKET_NAME is not set; skipping S3 upload"
        exit 0
    fi

    aws s3 cp "$BACKUP_PATH" "s3://${S3_BUCKET_NAME}/backups/${BACKUP_NAME}"
fi

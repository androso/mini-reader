# Manual AWS Lightsail deployment

This is the manual fallback for the low-cost AWS deployment. Prefer
`docs/aws-lightsail-cloudformation-deploy.md` for first provisioning.

This deploys Reader on one AWS Lightsail instance with:

- one app container for the API, web app, and in-process book processor
- one local Postgres container with pgvector
- S3 for uploaded EPUB/PDF files and optional DB backup uploads
- Caddy on the host for HTTPS

The target instance is the Lightsail 2GB plan. Add swap before building the app.

## 1. Create AWS resources

1. Create an Ubuntu Lightsail instance.
2. Attach a static IP.
3. Point your DNS `A` record at the static IP.
4. Create or reuse an S3 bucket for uploads.
5. Create an IAM access key with least-privilege access to the bucket:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
            "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/*"
        },
        {
            "Effect": "Allow",
            "Action": ["s3:ListBucket"],
            "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME"
        }
    ]
}
```

## 2. Prepare the instance

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git ufw awscli gettext-base

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

Log out and back in so the Docker group takes effect.

Add swap:

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Open only SSH/HTTP/HTTPS:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

## 3. Configure Reader

```bash
sudo mkdir -p /opt/reader
sudo chown "$USER:$USER" /opt/reader
cd /opt/reader
git clone YOUR_REPO_URL .
cp .env.prod.example .env.prod
```

Edit `.env.prod` and set:

- `READER_DOMAIN`
- `POSTGRES_PASSWORD`
- `JWT_SECRET`
- `FRONTEND_URL`
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID` for Google Identity Services and the matching
  `GOOGLE_CLIENT_ID` API token audience
- `OPENAI_API_KEY`
- S3 bucket and access key values

`POSTGRES_PASSWORD` is interpolated directly into Compose's `DATABASE_URL`.
Use only URI-unreserved characters (`A-Z`, `a-z`, `0-9`, `.`, `_`, `~`, and
`-`); do not use reserved characters such as `/`, `?`, `#`, `@`, or `:`.

For this deployment, keep:

```bash
NEXT_PUBLIC_API_URL=
STORAGE_DRIVER=s3
VECTOR_STORE_DRIVER=pg
BOOK_PROCESSING_RUNNER_ENABLED=true
```

Set `FRONTEND_URL` to exactly `https://$READER_DOMAIN` and keep
`NEXT_PUBLIC_API_URL` empty. That makes the browser and API same-origin through
Caddy, which is required by the API's unsafe-request Origin check and secure
`__Host-reader_session` cookie. The Compose file exposes the app ports only on
loopback, so Caddy remains the sole public and trusted proxy hop.

## 4. Build, migrate, and start

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml build app
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d postgres
docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm app pnpm db:migrate
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
```

Check health:

```bash
curl http://127.0.0.1:3000/health
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f app
```

## 5. Configure Caddy

Install Caddy:

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update
sudo apt-get install -y caddy
```

Install the repo Caddyfile:

```bash
set -a
. ./.env.prod
set +a
envsubst < Caddyfile | sudo tee /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Visit `https://$READER_DOMAIN`.

## Runtime and compatibility guarantees

`pnpm db:migrate` applies the Postgres queue/pgvector migration (`0012`), legacy
file-type backfill (`0013`), UUID progress constraints (`0014`), chat completion
fields (`0015`), and private execution metadata (`0016`). Existing object keys
and collection names remain supported, while new clients use only book UUIDs.

Book processing is single-flight inside the app process. Queue failures preserve
the S3 original in `queue_failed` for `POST /api/books/{bookId}/retry`.
Deletion moves through `deleting`, removes queued work, and can be retried with
the same DELETE request if artifact cleanup fails. A complete recovery therefore
requires both the Postgres volume backup and the S3 originals.

## 6. Backups

Create the backup directory:

```bash
sudo mkdir -p /opt/reader/backups
sudo chown "$USER:$USER" /opt/reader/backups
```

Run a manual backup:

```bash
./scripts/backup-lightsail-db.sh
```

Add a nightly cron entry:

```bash
crontab -e
```

```cron
15 3 * * * cd /opt/reader && ./scripts/backup-lightsail-db.sh >> /opt/reader/backups/backup.log 2>&1
```

## 7. Updates

```bash
cd /opt/reader
git pull
docker compose --env-file .env.prod -f docker-compose.prod.yml build app
docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm app pnpm db:migrate
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f app
```

## Smoke test

1. Sign in and confirm production sets an HttpOnly, Secure
   `__Host-reader_session`; log out and confirm the API returns `204` and clears
   both supported cookie names.
2. Confirm a malformed PDF or EPUB receives a generic `400` before a book or S3
   object is created, then upload one small valid book.
3. Use its UUID with `/api/books/{bookId}/status`, open the protected file, and
   confirm progress saves and restores for its owner but not another user.
4. If a book is `queue_failed`, retry it through
   `POST /api/books/{bookId}/retry`; delete a test book and confirm it disappears
   without a late processor publishing it again.
5. Ask a chat question and confirm the stream emits a terminal outcome. A
   legitimate no-match may return the fixed refusal; processing, failed, or
   unavailable context must fail closed rather than call the model.
6. Open an EPUB containing executable markup and confirm it is sanitized. Scroll
   the library and confirm EPUB covers load only near the viewport without stale
   covers appearing on another book.
7. Reboot the instance and confirm the app, database, progress/chat history, and
   S3 file retrieval still work.

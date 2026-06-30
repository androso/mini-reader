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
- Google OAuth values
- `OPENAI_API_KEY`
- S3 bucket and access key values

For this deployment, keep:

```bash
NEXT_PUBLIC_API_URL=
STORAGE_DRIVER=s3
VECTOR_STORE_DRIVER=pg
BOOK_PROCESSING_RUNNER_ENABLED=true
```

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

1. Open the app.
2. Sign in.
3. Upload a small EPUB.
4. Confirm `/api/books/:id/status` transitions from `processing` to `ready`.
5. Open the book.
6. Ask one chat question and confirm source-backed context appears.
7. Reboot the instance and confirm the app, database, and S3 file retrieval still work.

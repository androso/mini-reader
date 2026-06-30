# AWS Lightsail CloudFormation deployment

This is the source of truth for the low-cost AWS deployment. It creates one
Lightsail instance, one static IP, S3 storage, and scoped IAM credentials for
Reader's uploads and database backups.

The app runs with Docker Compose on the instance:

- `app`: web, API, and in-process book processor
- `postgres`: local Postgres with pgvector
- host Caddy: HTTPS reverse proxy
- S3: uploaded books and optional DB backups

## 1. Prepare parameters

Copy the example file and fill every placeholder:

```bash
cp infra/cloudformation/environments/prod/parameters.example.json \
  infra/cloudformation/environments/prod/parameters.json
```

Set these required values:

- `DomainName`: the public hostname, for example `reader.example.com`
- `RepoUrl`: the repository URL the instance can clone
- `RepoBranch`: the branch to deploy on first boot
- Google OAuth client id and secret
- OpenAI API key
- JWT secret
- Postgres password

Leave `ExistingBucketName` empty to create a bucket named
`reader-prod-ACCOUNT-REGION`. Set it to an existing bucket name to reuse a
bucket instead.

## 2. Create the stack

```bash
AWS_REGION=us-east-1 STACK_NAME=reader-prod ./scripts/deploy-cloudformation.sh
```

The script deploys `infra/cloudformation/reader-prod.yaml` directly. There are
no nested templates and no CloudFormation artifact bucket.

Important outputs:

- `StaticIpAddress`: create a DNS `A` record for `DomainName` with this value.
- `SshCommand`: SSH entrypoint for instance operations.
- `AppUrl`: public HTTPS URL after DNS points at the static IP.
- `S3BucketName`: upload and backup bucket.
- `S3AccessKeyId`: generated IAM access key id used by the instance.

CloudFormation passes the matching secret access key to first-boot user data and
writes it into `/opt/reader/.env.prod`. It is not emitted as a stack output.

## 3. First boot

SSH to the instance and watch the bootstrap logs:

```bash
sudo tail -f /var/log/reader-bootstrap.log
```

The generic cloud-init log is also useful when the launch script fails before
the Reader bootstrap logger starts:

```bash
sudo tail -f /var/log/cloud-init-output.log
```

The bootstrap process:

1. installs Docker, Docker Compose, Caddy, Git, AWS CLI, UFW, and support packages;
2. creates a 4GB swap file;
3. clones the configured repo and branch into `/opt/reader`;
4. writes `/opt/reader/.env.prod`;
5. builds the app image;
6. starts Postgres;
7. runs `pnpm db:migrate` inside the app container;
8. starts the full Compose stack;
9. installs the rendered Caddyfile and reloads Caddy;
10. registers a nightly database backup cron job.

Check the app locally on the instance:

```bash
cd /opt/reader
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
curl http://127.0.0.1:3000/health
```

After DNS is pointed at the static IP, visit `https://reader.example.com`.
Caddy will request and renew the TLS certificate automatically.

## 4. Updates

Deployments after the first boot are manual:

```bash
cd /opt/reader
git pull
docker compose --env-file .env.prod -f docker-compose.prod.yml build app
docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm app pnpm db:migrate
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f app
```

Downtime during rebuilds is acceptable for this single-user deployment.

## 5. Backups

Database data lives in the Docker volume `reader_postgres_data`. Uploaded files
live in S3.

The bootstrap registers:

```cron
15 3 * * * ubuntu cd /opt/reader && ./scripts/backup-lightsail-db.sh >> /opt/reader/backups/backup.log 2>&1
```

Run a manual backup:

```bash
cd /opt/reader
./scripts/backup-lightsail-db.sh
```

Backups are written under `/opt/reader/backups` and uploaded to the configured
S3 bucket when AWS credentials and bucket values are present.

## 6. Recovery checks

After a reboot:

```bash
sudo reboot
```

Then verify:

```bash
cd /opt/reader
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
curl http://127.0.0.1:3000/health
```

Run a product smoke test:

1. sign in;
2. upload one small EPUB or PDF;
3. confirm `/api/books/:id/status` moves from `processing` to `ready`;
4. open the book;
5. ask one chat question and confirm source-backed context appears.

## Notes

- This stack intentionally does not create ECS, RDS, Redis, ElastiCache, EFS,
  Chroma, ALBs, or GitHub Actions deployment roles.
- The vector store is pgvector via `VECTOR_STORE_DRIVER=pg`.
- Book processing runs in the app container with concurrency `1`.
- First boot writes secrets into `/opt/reader/.env.prod` and cloud-init logs may
  include bootstrap context. Treat the instance and stack events as sensitive.

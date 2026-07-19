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
- Google OAuth client ID, used by the browser and as the API token audience
- OpenAI API key
- JWT secret
- Postgres password

Existing local parameter files may still contain `GoogleClientSecretValue`.
The template accepts that deprecated key for compatibility but ignores its
value; new parameter files should omit it.

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

The deploy script reads stack outputs and then bootstraps the instance over SSH.
This is intentional: Lightsail launch user data can be opaque when it fails, so
the app setup runs as a visible SSH step instead.

## 3. Bootstrap

By default, `./scripts/deploy-cloudformation.sh` waits for SSH and then runs
`./scripts/bootstrap-lightsail-remote.sh`. If you need to use a specific SSH key,
set `SSH_KEY`:

```bash
AWS_REGION=us-east-1 STACK_NAME=reader-prod SSH_KEY=~/.ssh/your-key.pem \
  ./scripts/deploy-cloudformation.sh
```

To create only AWS resources and skip app setup:

```bash
RUN_REMOTE_BOOTSTRAP=false AWS_REGION=us-east-1 STACK_NAME=reader-prod \
  ./scripts/deploy-cloudformation.sh
```

Then run bootstrap later:

```bash
AWS_REGION=us-east-1 STACK_NAME=reader-prod SSH_KEY=~/.ssh/your-key.pem \
  ./scripts/bootstrap-lightsail-remote.sh
```

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

1. installs Docker, Docker Compose, Caddy, Git, AWS CLI v2, UFW, and support packages;
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

The bootstrap sets `FRONTEND_URL` to that exact HTTPS origin and leaves
`NEXT_PUBLIC_API_URL` empty. Browser mutations therefore satisfy the API Origin
check and use the Secure, HttpOnly `__Host-reader_session` cookie through one
same-origin Caddy entrypoint. Compose binds the API and web ports to loopback;
Caddy is the only public ingress and trusted proxy hop.

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

1. sign in and verify the production session cookie, then log out and verify the
   `204` response clears both supported cookie names;
2. reject a malformed upload with a generic `400`, then upload a small valid
   EPUB or PDF;
3. use its UUID to confirm `/api/books/{bookId}/status` moves from `processing`
   to `ready`, open the protected file, and save/restore owner-scoped progress;
4. exercise `POST /api/books/{bookId}/retry` for a `queue_failed` book and delete
   a test book without a late processing publication;
5. ask one chat question and confirm a terminal completion outcome. A no-match
   may return the fixed refusal; unavailable context must fail closed;
6. confirm executable EPUB markup is sanitized and EPUB covers load only near
   the viewport without stale blob URLs.

## Notes

- This stack intentionally does not create ECS, RDS, Redis, ElastiCache, EFS,
  Chroma, ALBs, or GitHub Actions deployment roles.
- The vector store is pgvector via `VECTOR_STORE_DRIVER=pg`.
- Book processing is single-flight in the app process through the Postgres-backed
  runner; `BOOK_PROCESSING_CONCURRENCY` is not a runtime tuning knob.
- Migrations `0012` through `0016` add the Postgres queue/pgvector path, legacy
  file-type compatibility, UUID progress constraints, completion outcomes, and
  private execution metadata. Existing object keys and collection names remain
  compatible; all public calls use book UUIDs.
- Queue failures preserve the S3 original for the retry endpoint. Deletion uses
  the retryable `deleting` state and removes queued work before artifact cleanup,
  so recovery requires both the database backup and S3 originals.
- First boot writes secrets into `/opt/reader/.env.prod` and cloud-init logs may
  include bootstrap context. Treat the instance and stack events as sensitive.

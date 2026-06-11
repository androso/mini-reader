# AWS Console Deployment Guide

This guide deploys the Reader platform from the AWS Console while keeping Chroma self-hosted inside AWS. It avoids Terraform, CloudFormation, CDK, and GitHub Actions.

## Target Architecture

- Web: Next.js app container on ECS Fargate.
- API: Express API container on ECS Fargate.
- Worker: BullMQ worker container on ECS Fargate.
- Chroma: private ECS Fargate service with persistent storage on EFS.
- Data: RDS PostgreSQL, ElastiCache Redis, S3, Secrets Manager, CloudWatch Logs.
- Public traffic: Application Load Balancers for web and API.
- Private traffic: API and worker reach Chroma through ECS service discovery inside the VPC.

## 1. Prepare Container Images

From your machine or any build environment, build and push three images to ECR:

```bash
reader-api
reader-worker
reader-web
```

The API image should start:

```bash
node -r dotenv/config apps/api/build/index.js
```

The worker image should start:

```bash
node -r dotenv/config apps/worker/build/index.js
```

The web image should start:

```bash
pnpm web:start -p 3000
```

For the web build, set:

```text
NEXT_PUBLIC_API_URL=https://api.your-domain.com
NEXT_PUBLIC_GOOGLE_CLIENT_ID=<google-client-id>
```

## 2. Create AWS Data Services

In the AWS Console:

1. Create or choose a VPC with at least two public subnets and two private subnets.
2. Create RDS PostgreSQL in private subnets.
3. Create ElastiCache Redis in private subnets.
4. Create an S3 bucket for uploaded books.
5. Create an EFS file system for Chroma persistence, with mount targets in the private subnets.

Security group rules:

- API and worker tasks can reach RDS on `5432`.
- API and worker tasks can reach Redis on `6379`.
- Chroma task can reach EFS on `2049`.
- API and worker tasks can reach Chroma on `8000`.
- Only the ALBs can reach the public web/API tasks on `3000`.

## 3. Store Runtime Secrets

Create Secrets Manager secrets for:

```text
DATABASE_URL
REDIS_URL
JWT_SECRET
OPENAI_API_KEY
CHROMA_CLIENT_AUTH_CREDENTIALS
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
DO_SPACES_NAME
DO_SPACES_ENDPOINT
DO_SPACES_KEY
DO_SPACES_SECRET
```

For AWS S3, keep the current app variable names:

```text
DO_SPACES_NAME=<s3-bucket-name>
DO_SPACES_ENDPOINT=https://s3.<region>.amazonaws.com
DO_SPACES_KEY=<access-key>
DO_SPACES_SECRET=<secret-key>
```

## 4. Create ECS Cluster

In ECS:

1. Create a Fargate cluster, for example `reader-prod`.
2. Enable CloudWatch Container Insights if you want easier debugging.
3. Create CloudWatch log groups for:
   - `/ecs/reader-prod/api`
   - `/ecs/reader-prod/worker`
   - `/ecs/reader-prod/web`
   - `/ecs/reader-prod/chroma`

## 5. Create Chroma Task And Service

Create a Fargate task definition:

- Container image: `chromadb/chroma:latest`
- Container port: `8000`
- CPU/memory: start with `1 vCPU / 2 GB`
- Environment:
  - `IS_PERSISTENT=TRUE`
  - `PERSIST_DIRECTORY=/chroma/chroma`
- EFS volume:
  - mount the EFS file system at `/chroma/chroma`
- Logs:
  - send to `/ecs/reader-prod/chroma`

Create an ECS service:

- Launch type: Fargate
- Subnets: private subnets
- Public IP: disabled
- Desired count: `1`
- Security group: allow inbound `8000` only from API/worker task security group
- Service discovery: create a private DNS name such as `chroma.reader-prod.local`

Your app services will use:

```text
CHROMA_URL=http://chroma.reader-prod.local:8000
```

## 6. Create API Task And Service

Create a Fargate task definition:

- Image: your `reader-api` ECR image
- Container port: `3000`
- Command: default image command
- CPU/memory: start with `1 vCPU / 2 GB`
- Environment:
  - `NODE_ENV=production`
  - `PORT=3000`
  - `FRONTEND_URL=https://reader.your-domain.com`
  - `CHROMA_URL=http://chroma.reader-prod.local:8000`
- Secrets from Secrets Manager:
  - `DATABASE_URL`
  - `REDIS_URL`
  - `JWT_SECRET`
  - `OPENAI_API_KEY`
  - `CHROMA_CLIENT_AUTH_CREDENTIALS`
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `DO_SPACES_NAME`
  - `DO_SPACES_ENDPOINT`
  - `DO_SPACES_KEY`
  - `DO_SPACES_SECRET`
- Logs: `/ecs/reader-prod/api`

Create an internet-facing Application Load Balancer:

- HTTPS listener on `443`
- HTTP listener on `80` redirecting to HTTPS
- Target group points to API tasks on port `3000`
- Health check path: `/`

Create the ECS service:

- Subnets: private subnets
- Public IP: disabled
- Attach it to the API target group
- Desired count: `1`

## 7. Create Worker Task And Service

Create a Fargate task definition:

- Image: your `reader-worker` ECR image
- No load balancer
- CPU/memory: start with `1 vCPU / 2 GB`
- Environment:
  - `NODE_ENV=production`
  - `CHROMA_URL=http://chroma.reader-prod.local:8000`
- Use the same Secrets Manager secrets as the API.
- Logs: `/ecs/reader-prod/worker`

Create the ECS service:

- Subnets: private subnets
- Public IP: disabled
- Desired count: `1`

## 8. Create Web Task And Service

Create a Fargate task definition:

- Image: your `reader-web` ECR image
- Container port: `3000`
- CPU/memory: start with `1 vCPU / 2 GB`
- Environment:
  - `NODE_ENV=production`
  - `PORT=3000`
- Logs: `/ecs/reader-prod/web`

Create a second internet-facing Application Load Balancer:

- HTTPS listener on `443`
- HTTP listener on `80` redirecting to HTTPS
- Target group points to web tasks on port `3000`
- Health check path: `/`

Create the ECS service:

- Subnets: private subnets
- Public IP: disabled
- Attach it to the web target group
- Desired count: `1`

## 9. Run Database Migrations

Run Drizzle migrations once after RDS is ready and before using the API:

```bash
DATABASE_URL='postgres://...' pnpm exec drizzle-kit migrate --config drizzle.config.ts
```

If your RDS is private-only, run this from a temporary ECS task, an EC2 instance in the VPC, or CloudShell connected through the right network path.

## 10. Configure DNS And OAuth

In Route 53 or your DNS provider:

- Point `api.your-domain.com` to the API ALB.
- Point `reader.your-domain.com` to the web ALB.

In Google OAuth:

- Add `https://reader.your-domain.com` as an allowed origin.
- Make sure the deployed web image was built with the same `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.

## 11. Validate The Deployment

Check:

- `https://api.your-domain.com/` returns `Hello World`.
- The web app loads at `https://reader.your-domain.com`.
- ECS services are stable: web, API, worker, Chroma.
- Chroma logs show persistent mode enabled.
- Restart the Chroma task and confirm existing book context still works.
- Upload a small EPUB/PDF and verify:
  - file lands in S3.
  - API inserts a `processing` book row.
  - Redis receives the job.
  - worker completes processing.
  - Chroma collection is created.
  - book becomes `ready`.

## Notes

- Chroma should stay private; do not expose port `8000` publicly.
- Keep one Chroma task at first. Scaling Chroma horizontally needs more care than scaling stateless API/web tasks.
- If uploads or processing fail, check CloudWatch logs for API, worker, and Chroma first.
- The current app still uses `DO_SPACES_*` names for S3-compatible object storage. Rename them later only with a code change.

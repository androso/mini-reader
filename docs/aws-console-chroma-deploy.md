# AWS Console Deployment Guide

This guide deploys Reader on AWS while keeping Chroma self-hosted. Infrastructure is created manually in the AWS Console. The repo-provided CI/CD only builds images, pushes them to ECR, runs migrations through ECS, and redeploys existing ECS services.

No Terraform, CloudFormation, or CDK is used.

## Target Architecture

- Web: Next.js container on ECS Fargate.
- API: Express API container on ECS Fargate.
- Worker: BullMQ worker container on ECS Fargate.
- Chroma: private ECS Fargate service with EFS persistence.
- Data services: RDS PostgreSQL, ElastiCache Redis, S3, Secrets Manager, CloudWatch Logs.
- Public traffic: separate HTTPS Application Load Balancers for web and API.
- Private traffic: API and worker reach Chroma through ECS service discovery inside the VPC.

## Repo Deployment Files

The branch includes:

```text
Dockerfile.api
Dockerfile.worker
Dockerfile.web
.github/workflows/aws-deploy.yml
scripts/deploy-images.sh
scripts/force-deploy-ecs-services.sh
scripts/run-ecs-migrations.sh
scripts/run-api-migrations.sh
```

It also adds `GET /health` for API load balancer health checks.

## 1. Create ECR Repositories

In ECR, create these repositories:

```text
reader-api
reader-worker
reader-web
```

The script `scripts/deploy-images.sh` can also create them automatically if the AWS role has ECR create permissions.

The workflow pushes two tags for each image:

```text
<git-sha>
latest
```

For console-managed ECS services, point container images at `:latest`, for example:

```text
<account-id>.dkr.ecr.<region>.amazonaws.com/reader-api:latest
```

## 2. Create Network And Data Services

In the AWS Console:

1. Create or choose a VPC with at least two public subnets and two private subnets.
2. Create RDS PostgreSQL in private subnets.
3. Create ElastiCache Redis in private subnets.
4. Create an S3 bucket for uploaded books.
5. Create an EFS file system for Chroma persistence, with mount targets in the private subnets.

Security group rules:

- ALB security groups accept public `80` and `443`.
- API and web task security group accepts `3000` only from its ALB.
- API and worker tasks can reach RDS on `5432`.
- API and worker tasks can reach Redis on `6379`.
- API and worker tasks can reach Chroma on `8000`.
- Chroma task can reach EFS on `2049`.
- Chroma should not allow public inbound traffic.

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

## 4. Create ECS Cluster And Logs

In ECS:

1. Create a Fargate cluster, for example `reader-prod`.
2. Enable CloudWatch Container Insights if desired.
3. Create CloudWatch log groups:

```text
/ecs/reader-prod/api
/ecs/reader-prod/worker
/ecs/reader-prod/web
/ecs/reader-prod/chroma
```

## 5. Create Chroma Task And Service

Create a Fargate task definition:

- Image: `chromadb/chroma:latest`
- Container port: `8000`
- CPU/memory: start with `1 vCPU / 2 GB`
- Environment:
  - `IS_PERSISTENT=TRUE`
  - `PERSIST_DIRECTORY=/chroma/chroma`
- EFS volume:
  - mount the EFS file system at `/chroma/chroma`
- Logs:
  - `/ecs/reader-prod/chroma`

Create an ECS service:

- Launch type: Fargate
- Subnets: private subnets
- Public IP: disabled
- Desired count: `1`
- Security group: inbound `8000` only from API/worker task security group
- Service discovery: create a private DNS name such as `chroma.reader-prod.local`

API and worker tasks will use:

```text
CHROMA_URL=http://chroma.reader-prod.local:8000
```

## 6. Create API Task And Service

Create a Fargate task definition:

- Image: `<account-id>.dkr.ecr.<region>.amazonaws.com/reader-api:latest`
- Container port: `3000`
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
- Health check path: `/health`

Create the ECS service:

- Subnets: private subnets
- Public IP: disabled
- Attach it to the API target group
- Desired count: `1`

## 7. Create Worker Task And Service

Create a Fargate task definition:

- Image: `<account-id>.dkr.ecr.<region>.amazonaws.com/reader-worker:latest`
- No load balancer
- CPU/memory: start with `1 vCPU / 2 GB`
- Environment:
  - `NODE_ENV=production`
  - `CHROMA_URL=http://chroma.reader-prod.local:8000`
- Use the same Secrets Manager values as the API.
- Logs: `/ecs/reader-prod/worker`

Create the ECS service:

- Subnets: private subnets
- Public IP: disabled
- Desired count: `1`

## 8. Create Web Task And Service

Create a Fargate task definition:

- Image: `<account-id>.dkr.ecr.<region>.amazonaws.com/reader-web:latest`
- Container port: `3000`
- CPU/memory: start with `1 vCPU / 2 GB`
- Environment:
  - `NODE_ENV=production`
  - `PORT=3000`
- Logs: `/ecs/reader-prod/web`

The web image bakes in these public values at build time:

```text
NEXT_PUBLIC_API_URL=https://api.your-domain.com
NEXT_PUBLIC_GOOGLE_CLIENT_ID=<google-client-id>
```

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

## 9. Create Migration Task Definition

Create one additional ECS task definition using the API image:

```text
<account-id>.dkr.ecr.<region>.amazonaws.com/reader-api:latest
```

Set the container command to:

```text
pnpm exec drizzle-kit migrate --config drizzle.config.ts
```

Use the same private subnets, task security group, and Secrets Manager values as the API service. CI/CD runs this task before redeploying services.

## 10. First Manual Image Push

After ECR exists and AWS credentials are configured locally:

```bash
AWS_ACCOUNT_ID=123456789012 \
AWS_REGION=us-east-1 \
NEXT_PUBLIC_API_URL=https://api.your-domain.com \
NEXT_PUBLIC_GOOGLE_CLIENT_ID=<google-client-id> \
./scripts/deploy-images.sh
```

Then create or update the ECS task definitions in the console to point at the pushed `:latest` images.

## 11. Run Migrations

If RDS is reachable from your current machine:

```bash
DATABASE_URL='postgres://...' ./scripts/run-api-migrations.sh
```

If RDS is private-only, use the ECS migration task instead:

```bash
AWS_REGION=us-east-1 \
ECS_CLUSTER=reader-prod \
ECS_MIGRATION_TASK_DEFINITION=<migration-task-definition-name-or-arn> \
ECS_PRIVATE_SUBNET_IDS=subnet-a,subnet-b \
ECS_TASK_SECURITY_GROUP_ID=sg-123456 \
./scripts/run-ecs-migrations.sh
```

## 12. Configure GitHub CI/CD

The workflow at `.github/workflows/aws-deploy.yml` does not create AWS infrastructure. It expects the console-created resources above to already exist.

It does:

1. run `pnpm test`,
2. run `pnpm build`,
3. build and push `reader-api`, `reader-worker`, and `reader-web` images,
4. run the ECS migration task,
5. force a new deployment for the existing API, worker, and web ECS services.

Set these GitHub repository variables:

```text
AWS_ACCOUNT_ID
AWS_REGION
NEXT_PUBLIC_API_URL
NEXT_PUBLIC_GOOGLE_CLIENT_ID
ECS_CLUSTER
ECS_API_SERVICE
ECS_WORKER_SERVICE
ECS_WEB_SERVICE
ECS_MIGRATION_TASK_DEFINITION
ECS_PRIVATE_SUBNET_IDS
ECS_TASK_SECURITY_GROUP_ID
```

Set this GitHub repository secret:

```text
AWS_DEPLOY_ROLE_ARN
```

The deploy role needs permissions for:

```text
ecr:GetAuthorizationToken
ecr:DescribeRepositories
ecr:CreateRepository
ecr:PutImage
ecr:InitiateLayerUpload
ecr:UploadLayerPart
ecr:CompleteLayerUpload
ecs:RunTask
ecs:DescribeTasks
ecs:UpdateService
ecs:DescribeServices
iam:PassRole
```

## 13. Configure DNS And OAuth

In Route 53 or your DNS provider:

- Point `api.your-domain.com` to the API ALB.
- Point `reader.your-domain.com` to the web ALB.

In Google OAuth:

- Add `https://reader.your-domain.com` as an allowed origin.
- Make sure `NEXT_PUBLIC_GOOGLE_CLIENT_ID` matches the OAuth client used by the API.

## 14. Validate The Deployment

Check:

- `https://api.your-domain.com/health` returns `{"status":"ok"}`.
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

# Rebuild Reader AWS Infrastructure

This is the source of truth for recreating Reader after the AWS account has been cleaned. The root stack is defined in `infra/cloudformation/reader-prod.yaml`; nested templates live under `infra/cloudformation/nested/`.

## What the stack creates

- A two-AZ VPC with public/private subnets, a regional NAT gateway, and an S3 gateway endpoint.
- ECR repositories for API, worker, and web images.
- ECS/Fargate services for API, worker, web, and Chroma, plus a migration task.
- Two public ALBs, private Cloud Map discovery for Chroma, RDS PostgreSQL, Redis, EFS, and S3.
- Runtime secrets, log groups, task roles, GitHub OIDC, and the GitHub deployment role.

The template deliberately starts all ECS services at desired count `0`. This lets a clean stack finish before application images have been pushed.

## Prerequisites

- AWS CLI authenticated as an administrator.
- Docker, `jq`, `cfn-lint`, Node 22, and pnpm 10.11.1.
- Region `us-east-1`, unless the template is deliberately adapted.
- Values for OpenAI, Google OAuth, JWT, and Chroma basic authentication.

Do not restore `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` application secrets. API, worker, and migration containers use ECS task roles and the AWS SDK default credential chain.

## 1. Prepare parameters

```bash
cp infra/cloudformation/environments/prod/parameters.example.json \
  infra/cloudformation/environments/prod/parameters.json
```

Fill every placeholder. `parameters.json` is gitignored. CloudFormation generates the database password and derives `DATABASE_URL`.

For the initial create, `FrontendUrl` may be `http://localhost`; all desired counts must remain `0`.

## 2. Validate and create the empty stack

```bash
cfn-lint -i W3002 -- infra/cloudformation/reader-prod.yaml infra/cloudformation/nested/*.yaml

export CFN_ARTIFACT_BUCKET="reader-prod-cloudformation-artifacts-$(aws sts get-caller-identity \
  --query Account --output text)-us-east-1"

aws s3api head-bucket --bucket "$CFN_ARTIFACT_BUCKET" 2>/dev/null || \
  aws s3api create-bucket --region us-east-1 --bucket "$CFN_ARTIFACT_BUCKET"

AWS_REGION=us-east-1 STACK_NAME=reader-prod CFN_ARTIFACT_BUCKET="$CFN_ARTIFACT_BUCKET" \
  ./scripts/deploy-cloudformation.sh
```

The deploy script packages local nested templates to the artifact bucket, then deploys the packaged root template. The deploy requires `CAPABILITY_NAMED_IAM`. Wait for `CREATE_COMPLETE`.

## 3. Export stack outputs

```bash
./scripts/export-cloudformation-env.sh
eval "$(./scripts/export-cloudformation-env.sh | grep -v '^AWS_DEPLOY_ROLE_ARN=')"
```

Update `FrontendUrl` in `parameters.json` to the emitted `WebUrl`, then deploy the stack once more. This configures API CORS with the actual web origin.

## 4. Build and push images

```bash
./scripts/deploy-images.sh
```

The web public environment variables are Docker build inputs. Updating ECS runtime environment variables does not change an already-built Next.js bundle.

## 5. Run migrations

```bash
./scripts/run-ecs-migrations.sh
```

Do not enable the API or worker before migrations succeed.

## 6. Start services

Change these values in `parameters.json`:

```json
{ "ParameterKey": "ApiDesiredCount", "ParameterValue": "1" },
{ "ParameterKey": "WorkerDesiredCount", "ParameterValue": "1" },
{ "ParameterKey": "WebDesiredCount", "ParameterValue": "1" },
{ "ParameterKey": "ChromaDesiredCount", "ParameterValue": "1" }
```

Run `./scripts/deploy-cloudformation.sh` again and wait for `UPDATE_COMPLETE`.

Verify:

```bash
curl "$(aws cloudformation describe-stacks \
  --stack-name reader-prod \
  --query "Stacks[0].Outputs[?OutputKey=='ApiHealthUrl'].OutputValue | [0]" \
  --output text)"
```

## 7. Configure GitHub Actions

Set:

- Repository secret `AWS_DEPLOY_ROLE_ARN` from stack output `GitHubActionsDeployRoleArn`.
- Repository variable `AWS_REGION=us-east-1`.
- Repository variable `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.

The workflow reads ECS names, subnet IDs, security group ID, API URL, and account ID directly from CloudFormation outputs. Do not duplicate those values in GitHub variables.

## Operational notes

- RDS deletion protection defaults to `true`. Set `DatabaseDeletionProtection=false` in a stack update before deleting the stack.
- S3, EFS, RDS snapshots, and Secrets Manager resources use retention policies. A stack deletion intentionally does not erase retained data.
- The current template exposes HTTP ALBs. Add ACM certificates, HTTPS listeners, and public DNS before treating this as an internet production deployment.
- Chroma uses the pinned `chromadb/chroma:1.0.15` image, EFS mounted at `/chroma/chroma`, and matching server/client basic-auth credentials.
- Never deploy with service counts above zero until ECR has the three `latest` application images.

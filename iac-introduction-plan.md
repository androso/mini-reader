# Introduce Infrastructure as Code Plan

## Context
The request is to introduce infrastructure as code for the Reader Platform project, and the user explicitly chose CloudFormation. The repo currently deploys to AWS manually: `docs/aws-console-chroma-deploy.md` states infrastructure is created in the AWS Console and that no Terraform, CloudFormation, or CDK is used; `.github/workflows/aws-deploy.yml` only tests/builds, pushes images, runs an ECS migration task, and force-redeploys existing ECS services. The intended end state is a CloudFormation-managed AWS production stack for the existing Reader topology, with the current Docker images and deployment scripts consuming stack outputs instead of hand-entered ECS/VPC values.

## Approach

### 1. Add a CloudFormation template for the documented production topology
Dependent on no other step. Create new CloudFormation code under `infra/cloudformation`; no existing IaC equivalent was found (`find` found no `infra/`, no `*.tf`, and `search` found only the doc line saying no Terraform/CloudFormation/CDK).

Concrete layout to create:

```text
infra/cloudformation/
  reader-prod.yml
  environments/prod/parameters.example.json
```

Use AWS CloudFormation, not Terraform/CDK/Pulumi, because the user selected CloudFormation and the target platform is already AWS ECS/ECR/S3/Secrets Manager. Do not add Terraform files, CDK apps, Pulumi projects, or CloudFormation nested stacks in this first pass; a single template avoids S3 template packaging and lets CI validate the stack without AWS credentials.

`infra/cloudformation/reader-prod.yml` must start with:

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Description: Reader production AWS infrastructure
```

Define these parameters exactly:

```yaml
Parameters:
  Project:
    Type: String
    Default: reader
  Environment:
    Type: String
    Default: prod
  VpcCidr:
    Type: String
    Default: 10.42.0.0/16
  PublicSubnetCidrs:
    Type: CommaDelimitedList
    Default: 10.42.0.0/24,10.42.1.0/24
  PrivateSubnetCidrs:
    Type: CommaDelimitedList
    Default: 10.42.10.0/24,10.42.11.0/24
  DomainName:
    Type: String
  WebSubdomain:
    Type: String
    Default: reader
  ApiSubdomain:
    Type: String
    Default: api
  GoogleClientId:
    Type: String
  OpenAiApiKey:
    Type: String
    NoEcho: true
  GoogleClientSecret:
    Type: String
    NoEcho: true
  ApiDesiredCount:
    Type: Number
    Default: 1
  WorkerDesiredCount:
    Type: Number
    Default: 1
  WebDesiredCount:
    Type: Number
    Default: 1
  ChromaDesiredCount:
    Type: Number
    Default: 1
  ChromaImage:
    Type: String
    Default: chromadb/chroma:latest
```

Use `!Sub "${Project}-${Environment}"` anywhere a resource name needs the shared `reader-prod` prefix. Use these literal FQDN expressions anywhere needed:

```yaml
!Sub "${WebSubdomain}.${DomainName}"
!Sub "${ApiSubdomain}.${DomainName}"
```

Apply the same tags to every taggable resource:

```yaml
Tags:
  - Key: Project
    Value: !Ref Project
  - Key: Environment
    Value: !Ref Environment
  - Key: ManagedBy
    Value: cloudformation
```

Use two availability zones from `!Select [0, !GetAZs ""]` and `!Select [1, !GetAZs ""]`. Create one NAT Gateway in the first public subnet to match the existing manual guide's singular NAT Gateway and keep the first IaC cutover low-cost.

Use these CloudFormation logical IDs so outputs, imports, and review are predictable: `Vpc`, `PublicSubnetA`, `PublicSubnetB`, `PrivateSubnetA`, `PrivateSubnetB`, `InternetGateway`, `VpcGatewayAttachment`, `NatEip`, `NatGateway`, `PublicRouteTable`, `PrivateRouteTable`, `PublicDefaultRoute`, `PrivateDefaultRoute`, `PublicSubnetARouteTableAssociation`, `PublicSubnetBRouteTableAssociation`, `PrivateSubnetARouteTableAssociation`, `PrivateSubnetBRouteTableAssociation`, `AlbApiSecurityGroup`, `AlbWebSecurityGroup`, `EcsApiSecurityGroup`, `EcsWebSecurityGroup`, `EcsWorkerSecurityGroup`, `EcsChromaSecurityGroup`, `EcsMigrationSecurityGroup`, `RdsSecurityGroup`, `RedisSecurityGroup`, `EfsSecurityGroup`, `HostedZone`, `Certificate`, `PrivateDnsNamespace`, `ApiLoadBalancer`, `WebLoadBalancer`, `ApiTargetGroup`, `WebTargetGroup`, `ApiHttpListener`, `ApiHttpsListener`, `WebHttpListener`, `WebHttpsListener`, `ApiAliasRecord`, `WebAliasRecord`, `ApiRepository`, `WorkerRepository`, `WebRepository`, `UploadsBucket`, `DbCredentialsSecret`, `PostgresSubnetGroup`, `PostgresInstance`, `RedisSubnetGroup`, `RedisCluster`, `ChromaFileSystem`, `ChromaMountTargetA`, `ChromaMountTargetB`, `DatabaseUrlSecret`, `JwtSecret`, `OpenAiApiKeySecret`, `GoogleClientSecretSecret`, `ChromaPasswordSecret`, `ChromaAuthCredentialsSecret`, `EcsTaskExecutionRole`, `ApiTaskRole`, `WorkerTaskRole`, `WebTaskRole`, `ChromaTaskRole`, `MigrationTaskRole`, `ApiLogGroup`, `WorkerLogGroup`, `WebLogGroup`, `ChromaLogGroup`, `MigrationLogGroup`, `EcsCluster`, `ApiTaskDefinition`, `WorkerTaskDefinition`, `WebTaskDefinition`, `ChromaTaskDefinition`, `MigrationTaskDefinition`, `ChromaDiscoveryService`, `ApiService`, `WorkerService`, `WebService`, and `ChromaService`.

`infra/cloudformation/environments/prod/parameters.example.json` must use placeholders for real secrets and set service desired counts to `0` for the first create/update before ECR contains images:

```json
[
  { "ParameterKey": "DomainName", "ParameterValue": "example.com" },
  { "ParameterKey": "GoogleClientId", "ParameterValue": "<google-client-id>" },
  { "ParameterKey": "OpenAiApiKey", "ParameterValue": "<openai-api-key>" },
  { "ParameterKey": "GoogleClientSecret", "ParameterValue": "<google-client-secret>" },
  { "ParameterKey": "ApiDesiredCount", "ParameterValue": "0" },
  { "ParameterKey": "WorkerDesiredCount", "ParameterValue": "0" },
  { "ParameterKey": "WebDesiredCount", "ParameterValue": "0" },
  { "ParameterKey": "ChromaDesiredCount", "ParameterValue": "0" }
]
```

Add `.gitignore` entries for generated CloudFormation deploy inputs:

```gitignore
infra/cloudformation/environments/prod/parameters.json
infra/cloudformation/**/*.changeset.json
```

Do not commit real `parameters.json` files or saved change-set JSON containing parameter values.

### 2. Define AWS networking, DNS, certificates, and load balancers
Depends on Step 1. Implement in `infra/cloudformation/reader-prod.yml`.

Create:
- VPC `reader-prod` with CIDR `10.42.0.0/16` by default.
- Two public subnets from `PublicSubnetCidrs` and two private subnets from `PrivateSubnetCidrs`.
- Internet gateway for public subnets.
- One NAT Gateway in `PublicSubnetA`; private route table sends `0.0.0.0/0` through that NAT.
- Route 53 public hosted zone for `DomainName`; manage DNS in Route 53 for this first IaC pass.
- ACM certificate in the stack region for `reader.<domain>` and `api.<domain>`, validated by Route 53 DNS records by setting `ValidationMethod: DNS` and `DomainValidationOptions` with `HostedZoneId: !Ref HostedZone` for both names; do not create separate validation record resources because CloudFormation manages them for this certificate pattern.
- Private Cloud Map namespace `reader-prod.local` for ECS service discovery.
- Two public ALBs, matching the manual guide: one API ALB and one web ALB.
- API target group: `HTTP`, target type `ip`, port `3000`, health check path `/health`, matcher `200`.
- Web target group: `HTTP`, target type `ip`, port `3000`, health check path `/`, matcher `200-399`.
- Each ALB has an HTTP `80` listener redirecting to HTTPS `443`, and an HTTPS `443` listener using the ACM certificate.
- Route 53 alias records: API FQDN -> API ALB, web FQDN -> web ALB.

Security groups:
- `AlbApiSecurityGroup`: inbound `80`/`443` from `0.0.0.0/0`; outbound all.
- `AlbWebSecurityGroup`: inbound `80`/`443` from `0.0.0.0/0`; outbound all.
- `EcsApiSecurityGroup`: inbound `3000` only from `AlbApiSecurityGroup`; outbound all.
- `EcsWebSecurityGroup`: inbound `3000` only from `AlbWebSecurityGroup`; outbound all.
- `EcsWorkerSecurityGroup`: no inbound; outbound all.
- `EcsChromaSecurityGroup`: inbound `8000` from `EcsApiSecurityGroup` and `EcsWorkerSecurityGroup`; outbound all.
- `EcsMigrationSecurityGroup`: no inbound; outbound all.
- `RdsSecurityGroup`: inbound `5432` from `EcsApiSecurityGroup`, `EcsWorkerSecurityGroup`, and `EcsMigrationSecurityGroup`; outbound all.
- `RedisSecurityGroup`: inbound `6379` from `EcsApiSecurityGroup` and `EcsWorkerSecurityGroup`; outbound all.
- `EfsSecurityGroup`: inbound `2049` only from `EcsChromaSecurityGroup`; outbound all.

Failure handling: no public ingress to Chroma, RDS, Redis, EFS, worker, or migration tasks. If the domain is not yet delegated to the Route 53 hosted zone, CloudFormation will pause during ACM DNS validation; while the stack is `CREATE_IN_PROGRESS`, fetch the created zone's nameservers with `aws route53 list-hosted-zones-by-name --dns-name "$DOMAIN_NAME" --query 'HostedZones[0].Id' --output text` followed by `aws route53 get-hosted-zone --id "$HOSTED_ZONE_ID" --query 'DelegationSet.NameServers' --output text`, update the registrar, then wait for stack completion. After completion the stack also outputs `Route53ZoneNameServers`.

### 3. Define data services and object storage
Depends on Step 2 private subnets and security groups. Implement in `infra/cloudformation/reader-prod.yml`.

Create:
- S3 bucket `${Project}-${Environment}-uploads-${AWS::AccountId}` for uploaded books.
  - Block all public access.
  - Enable server-side encryption AES256.
  - Enable versioning.
  - Do not add public bucket policy or CORS; current API serves files through authenticated Express routes, not direct browser S3 access.
  - Set `DeletionPolicy: Retain` and `UpdateReplacePolicy: Retain`.
- RDS PostgreSQL instance:
  - Identifier `${Project}-${Environment}-postgres`.
  - Engine `postgres`, engine version `16`.
  - Instance class `db.t4g.micro`.
  - Allocated storage `20`, storage type `gp3`.
  - Private subnet group using `PrivateSubnetA` and `PrivateSubnetB`.
  - Public accessibility `false`.
  - Database name `reader`.
  - Master username `reader`.
  - Master password from `DbCredentialsSecret`, generated by Secrets Manager with `PasswordLength: 32`, `GenerateStringKey: password`, `SecretStringTemplate: '{"username":"reader"}'`, and `ExcludePunctuation: true` so the derived Postgres URI is valid without URL encoding.
  - Deletion protection `true` for prod.
  - Set `DeletionPolicy: Snapshot` and `UpdateReplacePolicy: Snapshot`.
- ElastiCache Redis:
  - Cluster id `${Project}-${Environment}-redis`.
  - Engine `redis`, engine version `7.1`.
  - Node type `cache.t4g.micro`.
  - One cache node.
  - Subnet group using the two private subnets.
  - Security group `RedisSecurityGroup`.
- EFS file system `${Project}-${Environment}-chroma` with mount targets in the private subnets and security group `EfsSecurityGroup` for Chroma persistence.
  - Set `DeletionPolicy: Retain` and `UpdateReplacePolicy: Retain`.

Connection literals to expose to ECS:
- `DATABASE_URL`: create `DatabaseUrlSecret` named `reader/prod/DATABASE_URL` with `SecretString` equivalent to `postgres://reader:<generated-db-password>@${PostgresInstance.Endpoint.Address}:${PostgresInstance.Endpoint.Port}/reader`. Use `!GetAtt PostgresInstance.Endpoint.Address`, `!GetAtt PostgresInstance.Endpoint.Port`, and a Secrets Manager dynamic reference to `DbCredentialsSecret` for the password segment.
- `REDIS_URL`: `redis://${RedisCluster.RedisEndpoint.Address}:6379` using `!GetAtt RedisCluster.RedisEndpoint.Address`; expose it to both API and worker because `packages/jobs/src/index.ts` throws `Missing required REDIS_URL environment variable` when the API enqueues book-processing jobs.
- `S3_ENDPOINT`: `https://s3.${AWS::Region}.amazonaws.com`.
- `S3_REGION`: `AWS::Region`.
- `S3_BUCKET_NAME`: the uploads bucket name.
- `CHROMA_URL`: `http://chroma.reader-prod.local:8000`.

### 4. Define secrets without adding long-lived AWS access keys
Depends on Step 3 for generated connection strings. Implement in `infra/cloudformation/reader-prod.yml`.

Create AWS Secrets Manager secrets for values CloudFormation can derive or receive as `NoEcho` parameters:
- `reader/prod/DATABASE_URL` from the RDS connection string above.
- `reader/prod/JWT_SECRET` from `JwtSecret` with `GenerateSecretString.PasswordLength: 48`.
- `reader/prod/OPENAI_API_KEY` from parameter `OpenAiApiKey`.
- `reader/prod/GOOGLE_CLIENT_SECRET` from parameter `GoogleClientSecret`.
- `reader/prod/CHROMA_AUTH_CREDENTIALS` from `ChromaAuthCredentialsSecret`; generate `ChromaPasswordSecret` with `PasswordLength: 32` and `ExcludePunctuation: true`, then set `ChromaAuthCredentialsSecret.SecretString` to `reader:<generated-chroma-password>` using a Secrets Manager dynamic reference to `ChromaPasswordSecret`.

Do not create or reference production secrets named `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY`. CloudFormation must provide task IAM roles for AWS access instead; this removes the current manual secret-map dependency on static IAM user keys.

Set `GOOGLE_CLIENT_ID` as a normal ECS environment variable from `GoogleClientId`; it is already a public Next.js build value in `apps/web/.env.template` and `.github/workflows/aws-deploy.yml`.

### 5. Update S3 credential handling to use ECS task roles
Depends on Step 4's decision to remove long-lived AWS keys. This is the only application-code change needed for the IaC cutover.

Edit `packages/providers/src/storage.ts` constructor:
- Replace the current `new S3Client({ endpoint: process.env.S3_ENDPOINT!, region: ..., credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID!, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY! } })` with a config object that omits `credentials` entirely.
- Include `endpoint` only when `process.env.S3_ENDPOINT` is set.
- Keep `region: process.env.S3_REGION || "us-east-1"`.
- Keep `STORAGE_DRIVER=local` behavior and `LOCAL_STORAGE_DIR` unchanged.

Exact behavior after the edit: locally, the AWS SDK default provider chain still honors `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` if a developer sets them; in ECS, it uses the task role credentials.

Update `apps/api/src/types/env.d.ts`:
- Remove required `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` entries from `ProcessEnv`.
- Keep `S3_BUCKET_NAME: string`; change `S3_ENDPOINT` to optional (`S3_ENDPOINT?: string`) because the provider only includes it when set; keep `S3_REGION?: string`; add required `REDIS_URL: string` because `apps/api/src/services/BookProcessingQueue.ts` uses `@reader/jobs` to enqueue uploads.

Delete `apps/api/src/services/S3Services.ts` if `search` for `S3Service|S3Services` still returns only that file; current search returned no callsites outside the file. Do not leave an unused parallel S3 implementation that still requires static credentials.

Update `.env.template`:
- Move `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` under a comment `# Optional local AWS SDK credentials; ECS uses task roles`.
- Keep `S3_BUCKET_NAME`, `S3_ENDPOINT`, and `S3_REGION`; add `REDIS_URL=` for local API and worker queue access.

### 6. Define ECR, IAM, ECS task definitions, and ECS services
Depends on Steps 2-5. Implement in `infra/cloudformation/reader-prod.yml`.

ECR:
- Create repositories `reader-api`, `reader-worker`, and `reader-web` with image scanning on push.
- Keep image tags mutable for compatibility with the current deploy flow, which pushes both `${IMAGE_TAG}` and `latest` and forces ECS service deployment.

IAM:
- ECS task execution role with AWS managed policy `service-role/AmazonECSTaskExecutionRolePolicy` and inline `secretsmanager:GetSecretValue` on the runtime secret ARNs.
- API task role with only S3 read/write/delete on the uploads bucket; do not add CloudWatch permissions to app task roles because repository AWS SDK usage is limited to S3 and the ECS execution role owns awslogs delivery.
- Worker task role with S3 read/write/delete on the uploads bucket.
- Web task role with no S3 permissions.
- Chroma task role with no app AWS permissions.
- Migration task role with the same app permissions as API, because it runs the API image but only executes Drizzle migrations.

CloudWatch log groups:
- `/ecs/reader-prod/api`
- `/ecs/reader-prod/worker`
- `/ecs/reader-prod/web`
- `/ecs/reader-prod/chroma`
- `/ecs/reader-prod/migration`

ECS cluster:
- Name `reader-prod`.
- Fargate launch type for all services/tasks.

Task definitions:
- API family `reader-prod-api`, container `api`, image `${ApiRepository.RepositoryUri}:latest`, CPU `1024`, memory `2048`, port `3000`, log group `/ecs/reader-prod/api`.
  - Environment: `NODE_ENV=production`, `PORT=3000`, `FRONTEND_URL=https://${WebSubdomain}.${DomainName}`, `CHROMA_URL=http://chroma.reader-prod.local:8000`, `STORAGE_DRIVER=s3`, `S3_BUCKET_NAME`, `S3_ENDPOINT`, `S3_REGION`, `REDIS_URL`, `GOOGLE_CLIENT_ID`.
  - Secrets: `DATABASE_URL`, `JWT_SECRET`, `OPENAI_API_KEY`, `GOOGLE_CLIENT_SECRET`, and `CHROMA_CLIENT_AUTH_CREDENTIALS` mapped from the single `reader/prod/CHROMA_AUTH_CREDENTIALS` secret ARN.
- Worker family `reader-prod-worker`, container `worker`, image `${WorkerRepository.RepositoryUri}:latest`, CPU `1024`, memory `2048`, no port mappings, log group `/ecs/reader-prod/worker`.
  - Environment: `NODE_ENV=production`, `CHROMA_URL=http://chroma.reader-prod.local:8000`, `STORAGE_DRIVER=s3`, `S3_BUCKET_NAME`, `S3_ENDPOINT`, `S3_REGION`, `REDIS_URL`.
  - Secrets: `DATABASE_URL`, `OPENAI_API_KEY`, and `CHROMA_CLIENT_AUTH_CREDENTIALS` from `reader/prod/CHROMA_AUTH_CREDENTIALS`.
- Web family `reader-prod-web`, container `web`, image `${WebRepository.RepositoryUri}:latest`, CPU `1024`, memory `2048`, port `3000`, log group `/ecs/reader-prod/web`.
  - Environment: `NODE_ENV=production`, `PORT=3000`.
  - No runtime secrets; `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` remain build args for `Dockerfile.web`.
- Chroma family `reader-prod-chroma`, container `chroma`, image `!Ref ChromaImage`, CPU `1024`, memory `2048`, port `8000`, log group `/ecs/reader-prod/chroma`.
  - Environment: `IS_PERSISTENT=TRUE`, `PERSIST_DIRECTORY=/chroma/chroma`, `CHROMA_SERVER_AUTHN_PROVIDER=chromadb.auth.basic_authn.BasicAuthenticationServerProvider`.
  - Secret: `CHROMA_SERVER_AUTHN_CREDENTIALS` from `reader/prod/CHROMA_AUTH_CREDENTIALS`.
  - Mount EFS at `/chroma/chroma` with transit encryption enabled.
- Migration family `reader-prod-migration`, container `migration`, image `${ApiRepository.RepositoryUri}:latest`, CPU `1024`, memory `2048`, no port mappings, log group `/ecs/reader-prod/migration`.
  - Command exactly: `["pnpm", "exec", "drizzle-kit", "migrate", "--config", "drizzle.config.ts"]`.
  - Environment/secrets match API, except no `PORT` is required.

ECS services:
- API service `reader-prod-api`, desired count `!Ref ApiDesiredCount`, private subnets, no public IP, security group `EcsApiSecurityGroup`, attach API target group.
- Worker service `reader-prod-worker`, desired count `!Ref WorkerDesiredCount`, private subnets, no public IP, security group `EcsWorkerSecurityGroup`, no load balancer.
- Web service `reader-prod-web`, desired count `!Ref WebDesiredCount`, private subnets, no public IP, security group `EcsWebSecurityGroup`, attach web target group.
- Chroma service `reader-prod-chroma`, desired count `!Ref ChromaDesiredCount`, private subnets, no public IP, security group `EcsChromaSecurityGroup`, Cloud Map service discovery name `chroma` in namespace `reader-prod.local`.

Edge handling:
- Initial stack creation can set all desired-count parameters to `0` until images exist in ECR; the CloudFormation template still validates and creates infrastructure. After the first `scripts/deploy-images.sh` push and migration task, update the stack with desired counts `1`.
- Do not reuse the existing gitignored JSON task-definition files as source of truth. CloudFormation becomes the task-definition source; after successful stack deployment, delete `api-task-def-*.json`, `worker-task-def-*.json`, `web-task-def.json`, `migration-task-def.json`, `current-task-def.json`, `secret-map.json`, and `secret-sources.txt` if they are still local scratch files and not tracked.

### 7. Make deployment consume CloudFormation outputs instead of GitHub-entered ECS values
Depends on Step 6 outputs. Update `.github/workflows/aws-deploy.yml` and `scripts/deploy-images.sh`.

Add CloudFormation outputs with these exact `OutputKey` names:

```yaml
Outputs:
  AwsRegion:
    Value: !Ref AWS::Region
  EcrApiRepositoryUrl:
    Value: !GetAtt ApiRepository.RepositoryUri
  EcrWorkerRepositoryUrl:
    Value: !GetAtt WorkerRepository.RepositoryUri
  EcrWebRepositoryUrl:
    Value: !GetAtt WebRepository.RepositoryUri
  EcsClusterName:
    Value: !Ref EcsCluster
  EcsApiServiceName:
    Value: !GetAtt ApiService.Name
  EcsWorkerServiceName:
    Value: !GetAtt WorkerService.Name
  EcsWebServiceName:
    Value: !GetAtt WebService.Name
  EcsMigrationTaskDefinitionArn:
    Value: !Ref MigrationTaskDefinition
  EcsPrivateSubnetIdsCsv:
    Value: !Join [",", [!Ref PrivateSubnetA, !Ref PrivateSubnetB]]
  EcsMigrationSecurityGroupId:
    Value: !Ref EcsMigrationSecurityGroup
  PublicApiUrl:
    Value: !Sub "https://${ApiSubdomain}.${DomainName}"
  PublicWebUrl:
    Value: !Sub "https://${WebSubdomain}.${DomainName}"
  NextPublicGoogleClientId:
    Value: !Ref GoogleClientId
  Route53ZoneNameServers:
    Value: { "Fn::Join": [",", { "Fn::GetAtt": ["HostedZone", "NameServers"] }] }
```

In `.github/workflows/aws-deploy.yml`:
- Keep `AWS_REGION: ${{ vars.AWS_REGION }}` and `PROJECT_NAME: reader`.
- Add `CLOUDFORMATION_STACK_NAME: reader-prod`.
- Keep `AWS_DEPLOY_ROLE_ARN` as the GitHub secret used by `aws-actions/configure-aws-credentials@v4`; CloudFormation does not manage that bootstrap trust relationship in this first pass.
- Remove top-level env entries for `AWS_ACCOUNT_ID`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `ECS_CLUSTER`, `ECS_API_SERVICE`, `ECS_WORKER_SERVICE`, `ECS_WEB_SERVICE`, `ECS_MIGRATION_TASK_DEFINITION`, `ECS_PRIVATE_SUBNET_IDS`, and `ECS_TASK_SECURITY_GROUP_ID`.
- After AWS credentials are configured and before `Build and push images`, add a step named `Load CloudFormation deployment outputs`:

```bash
get_output() {
  aws cloudformation describe-stacks \
    --region "$AWS_REGION" \
    --stack-name "$CLOUDFORMATION_STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" \
    --output text
}

AWS_ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
{
  echo "AWS_ACCOUNT_ID=$AWS_ACCOUNT_ID"
  echo "NEXT_PUBLIC_API_URL=$(get_output PublicApiUrl)"
  echo "NEXT_PUBLIC_GOOGLE_CLIENT_ID=$(get_output NextPublicGoogleClientId)"
  echo "ECS_CLUSTER=$(get_output EcsClusterName)"
  echo "ECS_API_SERVICE=$(get_output EcsApiServiceName)"
  echo "ECS_WORKER_SERVICE=$(get_output EcsWorkerServiceName)"
  echo "ECS_WEB_SERVICE=$(get_output EcsWebServiceName)"
  echo "ECS_MIGRATION_TASK_DEFINITION=$(get_output EcsMigrationTaskDefinitionArn)"
  echo "ECS_PRIVATE_SUBNET_IDS=$(get_output EcsPrivateSubnetIdsCsv)"
  echo "ECS_TASK_SECURITY_GROUP_ID=$(get_output EcsMigrationSecurityGroupId)"
} >> "$GITHUB_ENV"
```

Update `scripts/deploy-images.sh`:
- Keep the existing build logic and web build args.
- Remove the fallback `aws ecr create-repository` block. With IaC, missing ECR repositories are infrastructure drift/error, not something the app deploy script creates implicitly.
- Keep `aws ecr describe-repositories` as a preflight check and fail with `ECR repository ${repository} is missing; deploy the CloudFormation stack first` when absent.

`run-ecs-migrations.sh` and `force-deploy-ecs-services.sh` keep their current interfaces; their environment variables now come from CloudFormation outputs.

### 8. Add CloudFormation validation CI without auto-applying infrastructure
Depends on Step 1. Create `.github/workflows/cloudformation-validate.yml`.

Workflow triggers: `pull_request` and `workflow_dispatch`.

Steps:
- checkout
- install cfn-lint with `python -m pip install cfn-lint`
- `cfn-lint infra/cloudformation/reader-prod.yml`

Do not run `aws cloudformation deploy`, `create-stack`, `update-stack`, `execute-change-set`, or any infrastructure apply from CI in this first pass. Applying infrastructure remains an explicit operator action after reviewing a CloudFormation change set; this avoids surprising changes to the manually-created production stack.

### 9. Update the existing AWS deployment documentation to point at CloudFormation
Depends on Steps 1-8. Update `docs/aws-console-chroma-deploy.md`; do not create a new docs file.

Concrete edits:
- Replace the line `No Terraform, CloudFormation, or CDK is used.` with `CloudFormation under infra/cloudformation is the source of truth for AWS infrastructure.`
- Replace the console creation sections with this CloudFormation flow:
  1. copy `infra/cloudformation/environments/prod/parameters.example.json` to ignored `infra/cloudformation/environments/prod/parameters.json` and fill the real domain/client/secret values
  2. create and review a change set with desired counts set to `0`:
     ```bash
     aws cloudformation create-change-set \
       --region us-east-1 \
       --stack-name reader-prod \
       --change-set-name reader-prod-initial \
       --change-set-type CREATE \
       --template-body file://infra/cloudformation/reader-prod.yml \
       --parameters file://infra/cloudformation/environments/prod/parameters.json \
       --capabilities CAPABILITY_NAMED_IAM
     aws cloudformation describe-change-set --region us-east-1 --stack-name reader-prod --change-set-name reader-prod-initial
     ```
  3. execute the reviewed change set:
     ```bash
     aws cloudformation execute-change-set --region us-east-1 --stack-name reader-prod --change-set-name reader-prod-initial
     aws cloudformation wait stack-create-complete --region us-east-1 --stack-name reader-prod
     ```
     If the stack waits on ACM validation because the registrar is not delegated to the new hosted zone yet, set `DOMAIN_NAME` to the production domain, fetch the hosted-zone nameservers with the commands in Step 2 failure handling, update the registrar, then rerun the `stack-create-complete` wait.
  4. run the first image push with values from CloudFormation outputs:
     ```bash
     get_output() { aws cloudformation describe-stacks --region us-east-1 --stack-name reader-prod --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" --output text; }
     AWS_ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)" \
     AWS_REGION="$(get_output AwsRegion)" \
     NEXT_PUBLIC_API_URL="$(get_output PublicApiUrl)" \
     NEXT_PUBLIC_GOOGLE_CLIENT_ID="$(get_output NextPublicGoogleClientId)" \
     ./scripts/deploy-images.sh
     ```
  5. run the ECS migration task before starting services:
     ```bash
     get_output() { aws cloudformation describe-stacks --region us-east-1 --stack-name reader-prod --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" --output text; }
     AWS_REGION="$(get_output AwsRegion)" \
     ECS_CLUSTER="$(get_output EcsClusterName)" \
     ECS_MIGRATION_TASK_DEFINITION="$(get_output EcsMigrationTaskDefinitionArn)" \
     ECS_PRIVATE_SUBNET_IDS="$(get_output EcsPrivateSubnetIdsCsv)" \
     ECS_TASK_SECURITY_GROUP_ID="$(get_output EcsMigrationSecurityGroupId)" \
     ./scripts/run-ecs-migrations.sh
     ```
  6. update `parameters.json` desired counts to `1`
  7. create/review/execute an UPDATE change set for the same stack
- Preserve the validation section that checks `/health`, web load, ECS service stability, Chroma persistence, and EPUB/PDF upload processing; update variable names so they refer to CloudFormation outputs.

## Critical files & anchors
- `docs/aws-console-chroma-deploy.md:1-15` — current target architecture and explicit statement that infrastructure is manual/no IaC.
- `.github/workflows/aws-deploy.yml:13-61` — current deployment variables and script order that must be rewired to CloudFormation outputs without changing test/build order.
- `scripts/deploy-images.sh:14-25` — current implicit ECR repository creation that must be removed once CloudFormation owns ECR.
- `packages/providers/src/storage.ts:21-30` — current explicit AWS access-key credential block that must be replaced with AWS SDK default credentials for ECS task roles.
- `packages/jobs/src/index.ts:32-40` — API and worker require `REDIS_URL`; omitting it breaks book-processing enqueue/consume paths.

## Verification
Run from repo root unless a command says otherwise.

Static CloudFormation checks:

```bash
python -m pip install cfn-lint
cfn-lint infra/cloudformation/reader-prod.yml
```

Application checks after the S3 credential edit:

```bash
pnpm --filter @reader/providers build
pnpm --filter @reader/api build
pnpm --filter @reader/worker build
pnpm test
pnpm web:lint
```

Deployment dry-run check, requiring AWS credentials for the target account and an ignored `infra/cloudformation/environments/prod/parameters.json` with real `DomainName`, `GoogleClientId`, `OpenAiApiKey`, and `GoogleClientSecret` values:

```bash
aws cloudformation create-change-set \
  --region us-east-1 \
  --stack-name reader-prod \
  --change-set-name reader-prod-plan \
  --change-set-type CREATE \
  --template-body file://infra/cloudformation/reader-prod.yml \
  --parameters file://infra/cloudformation/environments/prod/parameters.json \
  --capabilities CAPABILITY_NAMED_IAM
aws cloudformation wait change-set-create-complete --region us-east-1 --stack-name reader-prod --change-set-name reader-prod-plan
aws cloudformation describe-change-set --region us-east-1 --stack-name reader-prod --change-set-name reader-prod-plan
aws cloudformation delete-change-set --region us-east-1 --stack-name reader-prod --change-set-name reader-prod-plan
```

Expected change-set behavior for a fresh environment:
- Creates ECR repositories `reader-api`, `reader-worker`, `reader-web`.
- Creates ECS services `reader-prod-api`, `reader-prod-worker`, `reader-prod-web`, and `reader-prod-chroma`.
- Creates a migration task definition `reader-prod-migration` with command `["pnpm", "exec", "drizzle-kit", "migrate", "--config", "drizzle.config.ts"]`.
- Creates API and web ALBs with HTTPS listeners and the API target group health check path `/health`.
- API and worker task definitions include `REDIS_URL`, and the API task definition does not include static AWS credential environment variables.
- Does not create Secrets Manager secrets named `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY`.

End-to-end smoke check after applying CloudFormation, pushing images, and running migrations:

```bash
get_output() { aws cloudformation describe-stacks --region us-east-1 --stack-name reader-prod --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" --output text; }
API_URL="$(get_output PublicApiUrl)"
WEB_URL="$(get_output PublicWebUrl)"
curl -fsS "$API_URL/health"
curl -fsSI "$WEB_URL/"
```

Expected observable output:
- `curl -fsS "$API_URL/health"` returns exactly JSON containing `"status":"ok"`, matching `apps/api/src/routes/Health.routes.ts`.
- `curl -fsSI "$WEB_URL/"` returns an HTTP `200` or redirect/HTML-success status in the `200-399` range.

Full behavioral check after smoke passes:
- ECS services API, web, worker, and Chroma are stable.
- Restart the Chroma task; EFS-backed Chroma data persists.
- Upload a small EPUB/PDF through the web UI; expected chain: API stores file in S3, inserts a `processing` book row, queues Redis/BullMQ job `book-processing`, worker completes processing, Chroma collection is created, `/api/books/:id/status` returns `ready: true`.

## Assumptions & contingencies
- AWS remains the target platform because the repo already has AWS ECS/ECR/S3/Secrets Manager deployment scripts and an AWS console deployment guide. If the intended target is not AWS, replace this plan rather than adapting it piecemeal.
- CloudFormation is the selected IaC tool because the user requested it. Do not add Terraform/CDK/Pulumi in this pass.
- Route 53 is the selected DNS authority for the first pass. If the domain is registered elsewhere, CloudFormation creates the hosted zone but ACM validation waits until the registrar is updated; fetch the nameservers during stack creation with the Step 2 Route 53 commands, update the registrar manually, and do not add non-Route53 DNS automation now.
- The first pass keeps mutable `:latest` ECS image references because `scripts/deploy-images.sh` and the existing docs are built around pushing `latest` plus a Git SHA and forcing ECS service deployment. Do not change to immutable SHA task-definition revisions until after CloudFormation is in place.
- If applying to an AWS account with already-created manual resources, do not let CloudFormation create duplicates. Import existing resources into the stack using the logical IDs named in this plan before executing the stack create/update. If an existing resource's settings conflict with this plan, change the AWS resource to match the plan before import unless doing so would cause downtime; for downtime risk, import as-is, then make the smallest CloudFormation-managed change in a separate change set.

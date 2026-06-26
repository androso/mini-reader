# CloudFormation infrastructure plan

## Context

The requested end state is a CloudFormation implementation plan for the AWS architecture discovered with AWS CLI and written in `aws_architecture_map.md`. The current repo deploys application images onto pre-existing AWS resources: `docs/aws-console-chroma-deploy.md` says infrastructure is console-created and no Terraform, CloudFormation, or CDK is used, while `.github/workflows/aws-deploy.yml` only tests/builds, pushes images, runs an ECS migration task, and redeploys ECS services. The first CloudFormation pass must codify the live `reader-prod` deployment as it exists now, not redesign it: VPC/subnets/routing, ALBs, ECS Fargate services/tasks, RDS, Redis, EFS, S3, Secrets Manager, IAM roles, ECR repositories, CloudWatch logs, and private service discovery.

## Approach

### 1. Add the CloudFormation file layout

Create these files exactly:

```text
infra/cloudformation/reader-prod.yaml
infra/cloudformation/environments/prod/parameters.example.json
```

Do not create Terraform, CDK, Pulumi, Serverless Framework, nested CloudFormation stacks, or a documentation file in this pass. Use one template because the current repo has no IaC framework and `docs/aws-console-chroma-deploy.md` is the only existing infra guide.

`infra/cloudformation/reader-prod.yaml` must start with:

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Description: Reader production infrastructure matching the live reader-prod AWS deployment
Metadata:
  Source:
    AccountId: "894650614733"
    Region: us-east-1
    DiscoveryFile: aws_architecture_map.md
    Mode: live-architecture-template-not-prod-deploy
```

Add a template comment immediately under `Metadata` saying this template is safe to validate, but must not be deployed into the existing prod account as a create/update until an explicit import or replacement cutover is planned; many physical names already exist and three resources are already owned by active CloudFormation stacks (`reader-prod` ECS cluster, `reader-prod-chroma` ECS service, Cloud Map namespace/service).

Create `parameters.example.json` with placeholders only; no real secret value belongs in git:

```json
[
  { "ParameterKey": "DbMasterPassword", "ParameterValue": "<existing-or-new-db-master-password>" },
  { "ParameterKey": "AwsAccessKeyIdSecretValue", "ParameterValue": "<existing-reader-backend-s3-user-access-key-id>" },
  { "ParameterKey": "AwsSecretAccessKeySecretValue", "ParameterValue": "<existing-reader-backend-s3-user-secret-access-key>" },
  { "ParameterKey": "DatabaseUrlSecretValue", "ParameterValue": "<postgres-url>" },
  { "ParameterKey": "RedisUrlSecretValue", "ParameterValue": "<redis-url>" },
  { "ParameterKey": "JwtSecretValue", "ParameterValue": "<jwt-secret>" },
  { "ParameterKey": "OpenAiApiKeySecretValue", "ParameterValue": "<openai-api-key>" },
  { "ParameterKey": "GoogleClientIdSecretValue", "ParameterValue": "<google-client-id>" },
  { "ParameterKey": "GoogleClientSecretValue", "ParameterValue": "<google-client-secret>" },
  { "ParameterKey": "ChromaServerAuthnCredentialsSecretValue", "ParameterValue": "<chroma-server-basic-auth-credentials>" },
  { "ParameterKey": "ChromaClientAuthCredentialsSecretValue", "ParameterValue": "<chroma-client-basic-auth-credentials>" },
  { "ParameterKey": "FrontendUrlSecretValue", "ParameterValue": "<frontend-url>" }
]
```

### 2. Define fixed parameters, mappings, and tags

In `reader-prod.yaml`, define parameters exactly for secret values and no other required runtime choice:

```yaml
Parameters:
  DbMasterPassword:
    Type: String
    NoEcho: true
  AwsAccessKeyIdSecretValue:
    Type: String
    NoEcho: true
  AwsSecretAccessKeySecretValue:
    Type: String
    NoEcho: true
  DatabaseUrlSecretValue:
    Type: String
    NoEcho: true
  RedisUrlSecretValue:
    Type: String
    NoEcho: true
  JwtSecretValue:
    Type: String
    NoEcho: true
  OpenAiApiKeySecretValue:
    Type: String
    NoEcho: true
  GoogleClientIdSecretValue:
    Type: String
    NoEcho: true
  GoogleClientSecretValue:
    Type: String
    NoEcho: true
  ChromaServerAuthnCredentialsSecretValue:
    Type: String
    NoEcho: true
  ChromaClientAuthCredentialsSecretValue:
    Type: String
    NoEcho: true
  FrontendUrlSecretValue:
    Type: String
    NoEcho: true
```

Use literal live names and values for non-secret infrastructure because the request is to codify the discovered deployment. Add this `Mappings` section so physical IDs from discovery are preserved for reviewers and later import planning without affecting stack validation:

```yaml
Mappings:
  LivePhysicalIds:
    Network:
      Vpc: vpc-0dbad7a7403ef4dc6
      DefaultVpcExcluded: vpc-05b3215dcc764dadc
      InternetGateway: igw-0e1fa3e6de9c45a08
      RegionalNatGateway: nat-1cfbc692e35d5879a
      S3GatewayEndpoint: vpce-05ad8976e079796a3
    Compute:
      EcsCluster: reader-prod
      ApiAlb: reader-prod-api-alb
      WebAlb: reader-prod-web-alb
      ApiTargetGroup: reader-prod-api-tg
      WebTargetGroup: reader-prod-web-tg
    Data:
      RdsInstance: reader-prod-postgres
      RedisCluster: reader-prod-redis-001
      EfsFileSystem: fs-091fd6cd9b2ab3089
      S3Bucket: reader-backend-894650614733-us-east-1-an
    ServiceDiscovery:
      Namespace: ns-oxx5qphail4wxonf
      ChromaService: srv-ynmmqa42y5eby3te
```

Apply these tags to every taggable resource that accepts CloudFormation `Tags`:

```yaml
- Key: project
  Value: reader
- Key: Name
  Value: <resource-specific-live-name>
```

Use lower-case `project=reader` on S3 to match the live bucket tag. Do not add `ManagedBy=cloudformation` in this template because that tag is not present on live resources and would make a future no-drift import harder.

### 3. Model the production VPC, routing, NAT, and S3 endpoint

In `reader-prod.yaml`, add these network resources with the exact logical IDs and properties below.

- `ReaderProdVpc` (`AWS::EC2::VPC`): `CidrBlock: 10.0.0.0/16`, `EnableDnsHostnames: true`, `EnableDnsSupport: true`, tag `Name=reader-prod-vpc`.
- `PublicSubnetA` (`AWS::EC2::Subnet`): VPC `ReaderProdVpc`, `AvailabilityZone: us-east-1a`, `CidrBlock: 10.0.0.0/20`, `MapPublicIpOnLaunch: false`, tag `Name=reader-prod-subnet-public1-us-east-1a`.
- `PublicSubnetB`: AZ `us-east-1b`, CIDR `10.0.16.0/20`, `MapPublicIpOnLaunch: false`, tag `Name=reader-prod-subnet-public2-us-east-1b`.
- `PrivateSubnetA`: AZ `us-east-1a`, CIDR `10.0.128.0/20`, `MapPublicIpOnLaunch: false`, tag `Name=reader-prod-subnet-private1-us-east-1a`.
- `PrivateSubnetB`: AZ `us-east-1b`, CIDR `10.0.144.0/20`, `MapPublicIpOnLaunch: false`, tag `Name=reader-prod-subnet-private2-us-east-1b`.
- `InternetGateway` and `VpcGatewayAttachment`: attach `igw` to `ReaderProdVpc`, tag `Name=reader-prod-vpc` only if CloudFormation accepts it for the resource.
- `RegionalNatEipA` (`AWS::EC2::EIP`): `Domain: vpc`, import/live allocation was `eipalloc-03b95ac67216df18d`, public IP `100.50.227.225`.
- `RegionalNatEipB`: `Domain: vpc`, import/live allocation was `eipalloc-00ef6eab17a3bb5c6`, public IP `23.21.139.9`.
- `RegionalNatGateway` (`AWS::EC2::NatGateway`): use the 2026 CloudFormation regional NAT properties confirmed by `aws cloudformation describe-type --type RESOURCE --type-name AWS::EC2::NatGateway`: `VpcId: !Ref ReaderProdVpc`, `ConnectivityType: public`, `AvailabilityMode: regional`, `AvailabilityZoneAddresses` with us-east-1a -> `!GetAtt RegionalNatEipA.AllocationId` and us-east-1b -> `!GetAtt RegionalNatEipB.AllocationId`, tag `Name=reader-prod-regional-nat`. Do not set `RouteTableId`, `AutoProvisionZones`, or `AutoScalingIps`; they are read-only in the resource schema.
- `PublicRouteTable`: routes `10.0.0.0/16` locally by default; add `PublicDefaultRoute` `0.0.0.0/0 -> InternetGateway`; associate to `PublicSubnetA` and `PublicSubnetB`.
- `PrivateRouteTableA` and `PrivateRouteTableB`: each gets `PrivateDefaultRouteA/B` `0.0.0.0/0 -> RegionalNatGateway`; associate A to `PrivateSubnetA` and B to `PrivateSubnetB`.
- `S3GatewayEndpoint` (`AWS::EC2::VPCEndpoint`): `ServiceName: !Sub com.amazonaws.${AWS::Region}.s3`, `VpcEndpointType: Gateway`, `VpcId: !Ref ReaderProdVpc`, `RouteTableIds: [!Ref PrivateRouteTableA, !Ref PrivateRouteTableB]`, matching live endpoint `vpce-05ad8976e079796a3` and routes to prefix list `pl-63a5400a`.

Do not model the default VPC `vpc-05b3215dcc764dadc` in CloudFormation. It has no discovered Reader application resources; creating or modifying default VPC resources is outside the Reader stack and would not help reproduce the app.

### 4. Model security groups, including live legacy groups

Create all non-default security groups in the prod VPC because the full discovered map includes active and apparently legacy Reader groups. Use separate `AWS::EC2::SecurityGroup` resources for groups and separate `AWS::EC2::SecurityGroupIngress` resources for rules that reference other groups, avoiding circular dependencies.

Active groups used by current services/data:

- `ApiAlbSecurityGroup`: name `reader-api-alb-sg`; ingress TCP `80` and `443` from `0.0.0.0/0`; egress all.
- `WebAlbSecurityGroup`: name `reader-prod-web-alb-sg`; ingress TCP `80` from `0.0.0.0/0`; egress all.
- `EcsTasksSecurityGroup`: name `reader-ecs-tasks-sg`; ingress TCP `3000` from `ApiAlbSecurityGroup`; egress all. Current API and worker services both attach this group.
- `WebTaskSecurityGroup`: name `reader-prod-web-task-sg`; ingress TCP `3000` from `WebAlbSecurityGroup`; egress all.
- `ChromaSecurityGroup`: name `reader-chroma-sg`; ingress TCP `8000` from `LegacyApiSecurityGroup`, `LegacyWorkerSecurityGroup`, and `EcsTasksSecurityGroup`; egress all.
- `RdsSecurityGroup`: name `reader-rds-sg`; ingress TCP `5432` from `LegacyApiSecurityGroup`, `LegacyWorkerSecurityGroup`, and `EcsTasksSecurityGroup`; egress all.
- `RedisSecurityGroup`: name `reader-redis-sg`; ingress TCP `6379` from `LegacyApiSecurityGroup`, `LegacyWorkerSecurityGroup`, and `EcsTasksSecurityGroup`; egress all.
- `EfsSecurityGroup`: name `reader-efs-sg`; ingress TCP `2049` from `ChromaSecurityGroup`; egress all.

Legacy/discovered groups to preserve because they exist in the live account:

- `LegacyWebAlbSecurityGroup`: name `reader-web-alb-sg`; ingress TCP `80` and `443` from `0.0.0.0/0`; egress all.
- `LegacyWebTaskSecurityGroup`: name `reader-web-sg`; ingress TCP `3000` from `LegacyWebAlbSecurityGroup`; egress all.
- `LegacyApiSecurityGroup`: name `reader-api-sg`; ingress TCP `3000` from `ApiAlbSecurityGroup`; egress all.
- `LegacyWorkerSecurityGroup`: name `reader-worker-sg`; no ingress; egress all.

Do not create CloudFormation resources for the prod VPC default security group or the default VPC default security group; CloudFormation creates a default VPC security group automatically and the default VPC is excluded in Step 3.

### 5. Model ECR, IAM, Secrets Manager, and CloudWatch Logs

Create ECR repositories with exact live repository names and properties:

- `ApiRepository`: `RepositoryName: reader-api`, `ImageTagMutability: MUTABLE`, `ImageScanningConfiguration.ScanOnPush: false`, AES256 encryption.
- `WorkerRepository`: `reader-worker`, same properties.
- `WebRepository`: `reader-web`, same properties.

Create IAM deployment/runtime resources:

- `GitHubActionsOidcProvider` (`AWS::IAM::OIDCProvider`) for `https://token.actions.githubusercontent.com`, client ID `sts.amazonaws.com`. Preserve the existing provider ARN in `LivePhysicalIds` comments; CloudFormation must not create a duplicate in prod without import.
- `EcsTaskExecutionRole`: role name `ecsTaskExecutionRole`, trust `ecs-tasks.amazonaws.com`, attach `arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy`, inline policy `ReaderProdSecretsAccess` allowing `secretsmanager:GetSecretValue` on `arn:aws:secretsmanager:us-east-1:894650614733:secret:reader/prod/*`.
- `GitHubActionsDeployRole`: role name `reader-github-actions-deploy-role`, trust the OIDC provider with `StringEquals token.actions.githubusercontent.com:aud = sts.amazonaws.com` and `StringLike token.actions.githubusercontent.com:sub = repo:androso/reader-backend:*`; inline policy `ReaderGitHubActionsDeployPolicy` with these exact statements:
  - `ECRAuthAndPush`: actions `ecr:GetAuthorizationToken`, `ecr:BatchCheckLayerAvailability`, `ecr:GetDownloadUrlForLayer`, `ecr:BatchGetImage`, `ecr:InitiateLayerUpload`, `ecr:UploadLayerPart`, `ecr:CompleteLayerUpload`, `ecr:PutImage`, `ecr:DescribeRepositories`, `ecr:CreateRepository`, resource `*`.
  - `ECSRunAndDeploy`: actions `ecs:RunTask`, `ecs:DescribeTasks`, `ecs:StopTask`, `ecs:UpdateService`, `ecs:DescribeServices`, `ecs:RegisterTaskDefinition`, `ecs:DescribeTaskDefinition`, resource `*`.
  - `PassRoleForECSTasks`: action `iam:PassRole`, resource `arn:aws:iam::894650614733:role/*`, condition `StringEqualsIfExists iam:PassedToService` in `[ecs-tasks.amazonaws.com, ecs.amazonaws.com]`.
  - `CloudWatchLogs`: actions `logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents`, `logs:DescribeLogGroups`, resource `*`.

Do not create AWS service-linked IAM roles or AWS-managed KMS keys. Live roles like `AWSServiceRoleForRDS` and aliases like `alias/aws/rds` are AWS-managed side effects of the services.

Create these Secrets Manager secrets with exact names and `KmsKeyId` omitted so `alias/aws/secretsmanager` is used, matching the live AWS-managed KMS key:

- `AwsAccessKeyIdSecret`: name `reader/prod/AWS_ACCESS_KEY_ID`, `SecretString: !Ref AwsAccessKeyIdSecretValue`.
- `AwsSecretAccessKeySecret`: name `reader/prod/AWS_SECRET_ACCESS_KEY`, `SecretString: !Ref AwsSecretAccessKeySecretValue`.
- `DatabaseUrlSecret`: name `reader/prod/DATABASE_URL`, `SecretString: !Ref DatabaseUrlSecretValue`.
- `RedisUrlSecret`: name `reader/prod/REDIS_URL`, `SecretString: !Ref RedisUrlSecretValue`.
- `JwtSecret`: name `reader/prod/JWT_SECRET`, `SecretString: !Ref JwtSecretValue`.
- `OpenAiApiKeySecret`: name `reader/prod/OPENAI_API_KEY`, `SecretString: !Ref OpenAiApiKeySecretValue`.
- `ChromaServerAuthnCredentialsSecret`: name `reader/prod/CHROMA_SERVER_AUTHN_CREDENTIALS`, `SecretString: !Ref ChromaServerAuthnCredentialsSecretValue`.
- `ChromaClientAuthCredentialsSecret`: name `reader/prod/CHROMA_CLIENT_AUTH_CREDENTIALS`, `SecretString: !Ref ChromaClientAuthCredentialsSecretValue`.
- `GoogleClientIdSecret`: name `reader/prod/GOOGLE_CLIENT_ID`, `SecretString: !Ref GoogleClientIdSecretValue`.
- `GoogleClientSecretSecret`: name `reader/prod/GOOGLE_CLIENT_SECRET`, `SecretString: !Ref GoogleClientSecretValue`.
- `S3BucketNameSecret`: name `reader/prod/S3_BUCKET_NAME`, `SecretString: !Ref UploadsBucket`.
- `S3EndpointSecret`: name `reader/prod/S3_ENDPOINT`, `SecretString: !Sub https://s3.${AWS::Region}.amazonaws.com`.
- `S3RegionSecret`: name `reader/prod/S3_REGION`, `SecretString: !Ref AWS::Region`.
- `FrontendUrlSecret`: name `reader/prod/FRONTEND_URL`, `SecretString: !Ref FrontendUrlSecretValue`.

Set `DeletionPolicy: Retain` and `UpdateReplacePolicy: Retain` on every secret.

Create log groups exactly:

- `/aws/ecs/containerinsights/reader-prod/performance`, retention `1` day.
- `/ecs/reader-prod/api`, retention `30` days.
- `/ecs/reader-prod/chroma`, retention `30` days.
- `/ecs/reader-prod/migration`, no `RetentionInDays` property because live retention is unset.
- `/ecs/reader-prod/web`, retention `30` days.
- `/ecs/reader-prod/worker`, retention `30` days.

### 6. Model data and storage services

Create `UploadsBucket` (`AWS::S3::Bucket`) with `BucketName: reader-backend-894650614733-us-east-1-an`, `BucketEncryption` SSE-S3 AES256 with `BucketKeyEnabled: true`, `PublicAccessBlockConfiguration` all four booleans `true`, tag `project=reader`, and no versioning property because live `get-bucket-versioning` returned `{}`. Add `DeletionPolicy: Retain` and `UpdateReplacePolicy: Retain`.

Create `RdsSubnetGroup` using all four prod subnets in the same order shown by live RDS discovery: `PrivateSubnetB`, `PublicSubnetA`, `PublicSubnetB`, `PrivateSubnetA`. Use `DBSubnetGroupName: default-vpc-0dbad7a7403ef4dc6` to match live. This includes public subnets because the live subnet group includes them; do not silently narrow to private-only in this pass.

Create `PostgresInstance` (`AWS::RDS::DBInstance`) with exact live properties:

- `DBInstanceIdentifier: reader-prod-postgres`
- `Engine: postgres`
- `EngineVersion: "18.3"`
- `DBInstanceClass: db.t4g.micro`
- `DBName: reader`
- `MasterUsername: postgres`
- `MasterUserPassword: !Ref DbMasterPassword`
- `AllocatedStorage: 20`
- `StorageType: gp3`
- `StorageEncrypted: true`
- `KmsKeyId: !Sub arn:aws:kms:${AWS::Region}:${AWS::AccountId}:alias/aws/rds` only if CloudFormation accepts AWS-managed alias ARNs for RDS; if validation rejects it, omit `KmsKeyId` so AWS uses `alias/aws/rds` by default.
- `MultiAZ: false`
- `PubliclyAccessible: false`
- `DeletionProtection: true`
- `BackupRetentionPeriod: 1`
- `PreferredBackupWindow: 08:46-09:16`
- `PreferredMaintenanceWindow: tue:03:09-tue:03:39`
- `CACertificateIdentifier: rds-ca-rsa2048-g1`
- `VPCSecurityGroups: [!Ref RdsSecurityGroup]`
- `DBSubnetGroupName: !Ref RdsSubnetGroup`
- `DeletionPolicy: Snapshot`, `UpdateReplacePolicy: Snapshot`

Create Redis resources:

- `RedisSubnetGroup` (`AWS::ElastiCache::SubnetGroup`): name `reader-prod-redis-subnets`, private subnets `PrivateSubnetA` and `PrivateSubnetB`.
- `RedisCluster` (`AWS::ElastiCache::CacheCluster`): `ClusterName: reader-prod-redis-001`, `Engine: redis`, `EngineVersion: 7.1`, `CacheNodeType: cache.t4g.micro`, `NumCacheNodes: 1`, `PreferredAvailabilityZone: us-east-1a`, `VpcSecurityGroupIds: [!Ref RedisSecurityGroup]`, `CacheSubnetGroupName: !Ref RedisSubnetGroup`, `TransitEncryptionEnabled: false`, `AtRestEncryptionEnabled: true` if CloudFormation accepts it for `AWS::ElastiCache::CacheCluster`; if validation rejects `AtRestEncryptionEnabled` on this resource type, omit it and keep a YAML comment with the live value.

Create EFS resources:

- `ChromaFileSystem` (`AWS::EFS::FileSystem`): name tag `reader-prod-chroma-efs`, `Encrypted: true`, omit `KmsKeyId` so AWS-managed `alias/aws/elasticfilesystem` is used, `PerformanceMode: generalPurpose`, `ThroughputMode: elastic`, `DeletionPolicy: Retain`, `UpdateReplacePolicy: Retain`.
- `ChromaMountTargetA`: file system `ChromaFileSystem`, subnet `PrivateSubnetA`, security group `EfsSecurityGroup`, live IP was `10.0.136.127`; do not set `IpAddress` unless CloudFormation validates it.
- `ChromaMountTargetB`: subnet `PrivateSubnetB`, same security group, live IP was `10.0.157.171`; same `IpAddress` rule.

### 7. Model private service discovery and load balancing

Create `PrivateDnsNamespace` (`AWS::ServiceDiscovery::PrivateDnsNamespace`) with `Name: reader-prod.local`, `Vpc: !Ref ReaderProdVpc`, `Properties.DnsProperties.SOA.TTL: 15` if the CloudFormation type supports it; otherwise omit SOA and keep a YAML comment with the live TTL. This resource maps to live namespace `ns-oxx5qphail4wxonf` and the private hosted zone `Z01714833FF09CLRB68OY`.

Create `ChromaDiscoveryService` (`AWS::ServiceDiscovery::Service`) with `Name: chroma`, `NamespaceId: !Ref PrivateDnsNamespace`, `DnsConfig.RoutingPolicy: MULTIVALUE`, `DnsConfig.DnsRecords: [{ Type: A, TTL: 15 }]`, and `HealthCheckCustomConfig.FailureThreshold: 1`. This maps to live service `srv-ynmmqa42y5eby3te` and creates the private record `chroma.reader-prod.local`.

Create ALBs and target groups exactly:

- `ApiLoadBalancer`: `AWS::ElasticLoadBalancingV2::LoadBalancer`, name `reader-prod-api-alb`, type `application`, scheme `internet-facing`, subnets public A/B, security group `ApiAlbSecurityGroup`.
- `WebLoadBalancer`: name `reader-prod-web-alb`, same type/scheme/subnets, security group `WebAlbSecurityGroup`.
- `ApiTargetGroup`: name `reader-prod-api-tg`, protocol HTTP, port `3000`, target type `ip`, VPC `ReaderProdVpc`, health check protocol HTTP, health check port `traffic-port`, health check path `/health`, matcher `200`.
- `WebTargetGroup`: name `reader-prod-web-tg`, protocol HTTP, port `3000`, target type `ip`, VPC `ReaderProdVpc`, health check path `/`, matcher `200-399`.
- `ApiHttpListener`: ALB `ApiLoadBalancer`, protocol HTTP, port `80`, default action forward to `ApiTargetGroup`. Do not add HTTPS or redirects; live API ALB has only HTTP `:80`.
- `WebHttpListener`: ALB `WebLoadBalancer`, protocol HTTP, port `80`, default action forward to `WebTargetGroup`. Do not add HTTPS or redirects; live web ALB has only HTTP `:80`.

Do not create public Route53 DNS or ACM certificates. Live discovery found no ACM certificates, no CloudFront distributions, no public hosted zone for web/API, and only the private `reader-prod.local` namespace.

### 8. Model ECS cluster, task definitions, and services

Create `EcsCluster` (`AWS::ECS::Cluster`) with `ClusterName: reader-prod` and `ClusterSettings` enabling Container Insights because `/aws/ecs/containerinsights/reader-prod/performance` exists.

Create task definitions with `NetworkMode: awsvpc`, `RequiresCompatibilities: [FARGATE]`, `Cpu: "1024"`, `Memory: "2048"`, `RuntimePlatform` X86_64/Linux, and `ExecutionRoleArn: !GetAtt EcsTaskExecutionRole.Arn`. Do not set `TaskRoleArn`; live task definitions have no task role ARN.

`ApiTaskDefinition`:

- `Family: reader-prod-api`
- Container `api`, image `!Sub ${AWS::AccountId}.dkr.ecr.${AWS::Region}.amazonaws.com/reader-api:latest`, essential `true`.
- Port mapping `containerPort: 3000`, `hostPort: 3000`, `protocol: tcp`, `name: api-3000`, `appProtocol: http`.
- Environment exactly: `NODE_ENV=production`, `CHROMA_URL=http://chroma.reader-prod.local:8000`, `PORT=3000`, `STORAGE_DRIVER=s3`, `FRONTEND_URL=!Sub http://${WebLoadBalancer.DNSName}`.
- Secrets exactly by env var name: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET`, `OPENAI_API_KEY`, `REDIS_URL`, `S3_BUCKET_NAME`, `S3_ENDPOINT`, `S3_REGION`, each `ValueFrom` referencing the corresponding secret resource from Step 5.
- Logs: `/ecs/reader-prod/api`, region `us-east-1`, stream prefix `ecs`.

`WorkerTaskDefinition`:

- `Family: reader-prod-worker`
- Container `worker`, image `reader-worker:latest`, port mapping `80/tcp`, `name: worker-80-tcp`, `appProtocol: http`.
- Environment exactly: `VECTOR_STORE_BATCH_SIZE=100`, `STORAGE_DRIVER=s3`, `VECTOR_STORE_BATCH_RETRY_DELAY_MS=1000`, `NODE_ENV=production`, `CHROMA_URL=http://chroma.reader-prod.local:8000`, `VECTOR_STORE_CONCURRENT_BATCHES=5`, `VECTOR_STORE_BATCH_RETRY_ATTEMPTS=3`.
- Secrets exactly: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `DATABASE_URL`, `OPENAI_API_KEY`, `REDIS_URL`, `S3_BUCKET_NAME`, `S3_ENDPOINT`, `S3_REGION`.
- Logs: `/ecs/reader-prod/worker`, region `us-east-1`, stream prefix `ecs`.

`WebTaskDefinition`:

- `Family: reader-prod-web`
- Container `web`, image `reader-web:latest`, port mapping `3000/tcp`, `name: web-3000`, `appProtocol: http`.
- Environment exactly: `NEXT_PUBLIC_GOOGLE_CLIENT_ID=572523987748-13792j9o3c39jeucq5ajqb3khvii6dk5.apps.googleusercontent.com`, `NODE_ENV=production`, `PORT=3000`, `NEXT_PUBLIC_API_URL=!Sub http://${ApiLoadBalancer.DNSName}`.
- No secrets.
- Logs: `/ecs/reader-prod/web`, region `us-east-1`, stream prefix `ecs`.

`ChromaTaskDefinition`:

- `Family: reader-prod-chroma`
- Container `chroma`, image `chromadb/chroma:latest`, port mapping `8000/tcp`, `name: chroma-8000`, `appProtocol: http`.
- Environment exactly: `IS_PERSISTENT=TRUE`, `PERSIST_DIRECTORY=/data`.
- No secrets. Do not add Chroma auth secrets in this pass; live Chroma task definition has none.
- Define volume `chroma-data` with `EFSVolumeConfiguration.FileSystemId: !Ref ChromaFileSystem`, `RootDirectory: /`.
- Do not add a container mount point in this pass; live task definition has the EFS volume declared but no `mountPoints`. Adding `/data` or another mount would change runtime behavior and belongs in a separate Chroma persistence fix.
- Logs: `/ecs/reader-prod/chroma`, region `us-east-1`, stream prefix `ecs`.

`MigrationTaskDefinition`:

- `Family: reader-prod-migration`
- Container `migration`, image `reader-api:latest`, no ports, command `['pnpm', 'exec', 'drizzle-kit', 'migrate', '--config', 'drizzle.config.ts']`.
- Environment exactly: `NODE_ENV=production`, `PORT=3000`, `CHROMA_URL=http://chroma.reader-prod.local:8000`, `STORAGE_DRIVER=s3`, `FRONTEND_URL=http://localhost`.
- Secrets exactly: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `OPENAI_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `S3_BUCKET_NAME`, `S3_ENDPOINT`, `S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.
- Logs: `/ecs/reader-prod/migration`, region `us-east-1`, stream prefix `ecs`.

Create ECS services exactly:

- `ApiService`: `ServiceName: reader-prod-api`, cluster `EcsCluster`, launch type `FARGATE`, desired count `1`, task definition `ApiTaskDefinition`, private subnets A/B, security groups `[EcsTasksSecurityGroup]`, `AssignPublicIp: ENABLED`, target group `ApiTargetGroup` container `api` port `3000`, deployment circuit breaker `Enable: true`, `Rollback: true`, `MaximumPercent: 200`, `MinimumHealthyPercent: 100`.
- `WorkerService`: `reader-prod-worker`, desired count `1`, task `WorkerTaskDefinition`, private subnets A/B, security groups `[EcsTasksSecurityGroup]`, `AssignPublicIp: ENABLED`, no load balancer, circuit breaker enabled/rollback true, max 200/min 100.
- `WebService`: `reader-prod-web`, desired count `1`, task `WebTaskDefinition`, private subnets A/B, security groups `[WebTaskSecurityGroup]`, `AssignPublicIp: DISABLED`, target group `WebTargetGroup` container `web` port `3000`, circuit breaker disabled/rollback false, max 200/min 100.
- `ChromaService`: `reader-prod-chroma`, desired count `1`, task `ChromaTaskDefinition`, private subnets A/B, security groups `[ChromaSecurityGroup]`, `AssignPublicIp: DISABLED`, no load balancer, service registry `ChromaDiscoveryService`, circuit breaker enabled/rollback true, max 200/min 100.

Add `DependsOn` relationships so listeners exist before API/web services and mount targets exist before Chroma service.

### 9. Add outputs consumed by deployment and operations

Add outputs whose names match the existing GitHub workflow variables and operational identifiers:

- `AWSRegion`: `!Ref AWS::Region`
- `AWSAccountId`: `!Ref AWS::AccountId`
- `ECSCluster`: `!Ref EcsCluster`
- `ECSApiService`: `!GetAtt ApiService.Name` if supported; otherwise `reader-prod-api`.
- `ECSWorkerService`: `reader-prod-worker`.
- `ECSWebService`: `reader-prod-web`.
- `ECSMigrationTaskDefinition`: `!Ref MigrationTaskDefinition`.
- `ECSPrivateSubnetIds`: `!Join [",", [!Ref PrivateSubnetA, !Ref PrivateSubnetB]]`.
- `ECSTaskSecurityGroupId`: `!Ref EcsTasksSecurityGroup`.
- `ApiAlbDnsName`: `!GetAtt ApiLoadBalancer.DNSName`.
- `WebAlbDnsName`: `!GetAtt WebLoadBalancer.DNSName`.
- `ApiHealthUrl`: `!Sub http://${ApiLoadBalancer.DNSName}/health`.
- `WebUrl`: `!Sub http://${WebLoadBalancer.DNSName}`.
- `S3BucketName`: `!Ref UploadsBucket`.
- `RdsEndpoint`: `!GetAtt PostgresInstance.Endpoint.Address`.
- `RedisEndpoint`: `!GetAtt RedisCluster.RedisEndpoint.Address`.
- `ChromaUrl`: literal `http://chroma.reader-prod.local:8000`.
- `GitHubActionsDeployRoleArn`: `!GetAtt GitHubActionsDeployRole.Arn`.

Do not update `.github/workflows/aws-deploy.yml` in this pass. The workflow already expects variables with these names at lines 13-27; after a real stack adoption, operators can copy output values into GitHub variables/secrets separately.

## Critical files & anchors

- `aws_architecture_map.md` — source map for live account `894650614733`, `us-east-1`; lines 36-66 summarize counts, lines 70-231 detail network/compute/data, lines 233-341 detail DNS/IAM/logs.
- `.github/workflows/aws-deploy.yml` — deployment contract to preserve: env vars at lines 13-27; image push, migration, and service redeploy at lines 54-61.
- `scripts/deploy-images.sh` — ECR repo/image naming contract: services `api worker web`, repositories `reader-${service}`, tags `${IMAGE_TAG}` and `latest`, lines 14-44.
- `scripts/run-ecs-migrations.sh` — migration execution contract: Fargate task definition, private subnet IDs, and task SG from env vars, lines 4-17.
- `docs/aws-console-chroma-deploy.md` — confirms no existing IaC and manual intended topology: lines 3-15, secrets list lines 86-104, ECS/log/deployment flow lines 118-168 and 312-344.

## Verification

Run from repo root after implementing the CloudFormation files. Use the AWS CLI login/admin credential source, not the limited `reader-backend-s3-user` environment credentials; if `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are set to that limited user, unset them first.

1. Validate CloudFormation syntax and resource schema:

```bash
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
aws cloudformation validate-template --template-body file://infra/cloudformation/reader-prod.yaml --region us-east-1
```

Expected: command exits 0 and returns the template parameters including all `*SecretValue` parameters.

2. Confirm the template summary includes the new behavior: the template models the live infrastructure, not only a skeleton.

```bash
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
aws cloudformation get-template-summary --template-body file://infra/cloudformation/reader-prod.yaml --region us-east-1 --query 'ResourceTypes' --output text
```

Expected output includes at least these resource types: `AWS::EC2::VPC`, `AWS::EC2::NatGateway`, `AWS::EC2::VPCEndpoint`, `AWS::ElasticLoadBalancingV2::LoadBalancer`, `AWS::ECS::Cluster`, `AWS::ECS::Service`, `AWS::ECS::TaskDefinition`, `AWS::RDS::DBInstance`, `AWS::ElastiCache::CacheCluster`, `AWS::EFS::FileSystem`, `AWS::S3::Bucket`, `AWS::SecretsManager::Secret`, `AWS::ServiceDiscovery::PrivateDnsNamespace`, `AWS::IAM::Role`, and `AWS::ECR::Repository`.

3. Confirm outputs cover the existing GitHub deployment variables by reading the `Outputs:` section in `infra/cloudformation/reader-prod.yaml`.

Expected: the section defines these exact output logical IDs and values: `AWSRegion`, `AWSAccountId`, `ECSCluster`, `ECSApiService`, `ECSWorkerService`, `ECSWebService`, `ECSMigrationTaskDefinition`, `ECSPrivateSubnetIds`, `ECSTaskSecurityGroupId`, `ApiAlbDnsName`, `WebAlbDnsName`, `ApiHealthUrl`, `WebUrl`, `S3BucketName`, `RdsEndpoint`, `RedisEndpoint`, `ChromaUrl`, `GitHubActionsDeployRoleArn`.

Do not run `aws cloudformation create-stack`, `update-stack`, `create-change-set`, or `execute-change-set` as verification for this implementation. The requested deliverable is the CloudFormation source, and prod has existing physical names and active CloudFormation ownership conflicts that need a separate import/cutover operation.

## Assumptions & contingencies

- This plan preserves the live HTTP-only ALBs. If a reviewer expects HTTPS, do not add ACM/443 in this implementation; write the current-state template first and schedule HTTPS as a separate behavior change.
- This plan preserves live ECS `AssignPublicIp` values: API and worker `ENABLED`, web and Chroma `DISABLED`. If a reviewer wants all private tasks to disable public IPs, do not change it here; that is a networking behavior change separate from codifying the current architecture.
- Live Chroma has an EFS file system and an ECS task definition volume, but no container mount point and `PERSIST_DIRECTORY=/data`. Preserve that exact state. If persistent Chroma storage is required, the fallback is a separate fix that mounts `chroma-data` at `/data` and verifies persistence after task restart.
- Live RDS subnet group includes both public and private subnets while the instance is not publicly accessible. Preserve that exact subnet group in this template. Narrowing it to private-only is a later cleanup/change-set, not part of current-state codification.
- CloudFormation property support was confirmed for regional NAT gateway properties via `aws cloudformation describe-type`. If validation rejects another service-specific property called out above (`AtRestEncryptionEnabled` for Redis cache cluster, EFS mount target `IpAddress`, private namespace SOA TTL, or AWS-managed KMS alias ARN for RDS), remove only that property and leave a YAML comment with the live value; do not substitute a different architecture.
- Do not attempt to make the template deploy cleanly into the existing prod account by renaming resources. A deployable duplicate stack would no longer be the map of the current deployment. The correct future prod adoption path is a separate import/replacement plan that accounts for resources already managed by `Infra-ECS-Cluster-reader-prod-774f59fd` and `ECS-Console-V2-Service-reader-prod-chroma-reader-prod-c84f6a00`.

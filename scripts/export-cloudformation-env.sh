#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
STACK_NAME="${STACK_NAME:-reader-prod}"

output() {
    aws cloudformation describe-stacks \
        --region "$AWS_REGION" \
        --stack-name "$STACK_NAME" \
        --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" \
        --output text
}

cat <<EOF
AWS_REGION=$(output AWSRegion)
AWS_ACCOUNT_ID=$(output AWSAccountId)
ECS_CLUSTER=$(output ECSCluster)
ECS_API_SERVICE=$(output ECSApiService)
ECS_WORKER_SERVICE=$(output ECSWorkerService)
ECS_WEB_SERVICE=$(output ECSWebService)
ECS_MIGRATION_TASK_DEFINITION=$(output ECSMigrationTaskDefinition)
ECS_PRIVATE_SUBNET_IDS=$(output ECSPrivateSubnetIds)
ECS_TASK_SECURITY_GROUP_ID=$(output ECSTaskSecurityGroupId)
NEXT_PUBLIC_API_URL=$(output ApiBaseUrl)
NEXT_PUBLIC_GOOGLE_CLIENT_ID=$(output NextPublicGoogleClientId)
AWS_DEPLOY_ROLE_ARN=$(output GitHubActionsDeployRoleArn)
EOF

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

checked_output() {
    local key="$1"
    local val
    val=$(output "$key")
    if [[ -z "$val" || "$val" == "None" ]]; then
        printf 'CloudFormation output %s is missing or empty for stack %s\n' "$key" "$STACK_NAME" >&2
        exit 1
    fi
    printf '%s' "$val"
}

aws_region=$(checked_output AWSRegion)
aws_account_id=$(checked_output AWSAccountId)
ecs_cluster=$(checked_output ECSCluster)
ecs_api_service=$(checked_output ECSApiService)
ecs_worker_service=$(checked_output ECSWorkerService)
ecs_web_service=$(checked_output ECSWebService)
ecs_migration_task_definition=$(checked_output ECSMigrationTaskDefinition)
ecs_private_subnet_ids=$(checked_output ECSPrivateSubnetIds)
ecs_task_security_group_id=$(checked_output ECSTaskSecurityGroupId)
next_public_api_url=$(checked_output ApiBaseUrl)
next_public_google_client_id=$(checked_output NextPublicGoogleClientId)
aws_deploy_role_arn=$(checked_output GitHubActionsDeployRoleArn)

cat <<EOF
AWS_REGION=$aws_region
AWS_ACCOUNT_ID=$aws_account_id
ECS_CLUSTER=$ecs_cluster
ECS_API_SERVICE=$ecs_api_service
ECS_WORKER_SERVICE=$ecs_worker_service
ECS_WEB_SERVICE=$ecs_web_service
ECS_MIGRATION_TASK_DEFINITION=$ecs_migration_task_definition
ECS_PRIVATE_SUBNET_IDS=$ecs_private_subnet_ids
ECS_TASK_SECURITY_GROUP_ID=$ecs_task_security_group_id
NEXT_PUBLIC_API_URL=$next_public_api_url
NEXT_PUBLIC_GOOGLE_CLIENT_ID=$next_public_google_client_id
AWS_DEPLOY_ROLE_ARN=$aws_deploy_role_arn
EOF

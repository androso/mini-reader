#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
ECS_CLUSTER="${ECS_CLUSTER:?Set ECS_CLUSTER to your ECS cluster name}"
ECS_MIGRATION_TASK_DEFINITION="${ECS_MIGRATION_TASK_DEFINITION:?Set ECS_MIGRATION_TASK_DEFINITION}"
ECS_PRIVATE_SUBNET_IDS="${ECS_PRIVATE_SUBNET_IDS:?Set comma-separated private subnet ids}"
ECS_TASK_SECURITY_GROUP_ID="${ECS_TASK_SECURITY_GROUP_ID:?Set ECS task security group id}"

TASK_ARN="$(aws ecs run-task \
    --region "$AWS_REGION" \
    --cluster "$ECS_CLUSTER" \
    --launch-type FARGATE \
    --task-definition "$ECS_MIGRATION_TASK_DEFINITION" \
    --network-configuration "awsvpcConfiguration={subnets=[$ECS_PRIVATE_SUBNET_IDS],securityGroups=[$ECS_TASK_SECURITY_GROUP_ID],assignPublicIp=DISABLED}" \
    --query "tasks[0].taskArn" \
    --output text)"

if [[ -z "$TASK_ARN" || "$TASK_ARN" == "None" ]]; then
    printf 'Failed to start migration task\n' >&2
    exit 1
fi

aws ecs wait tasks-stopped \
    --region "$AWS_REGION" \
    --cluster "$ECS_CLUSTER" \
    --tasks "$TASK_ARN"

EXIT_CODE="$(aws ecs describe-tasks \
    --region "$AWS_REGION" \
    --cluster "$ECS_CLUSTER" \
    --tasks "$TASK_ARN" \
    --query "tasks[0].containers[0].exitCode" \
    --output text)"

if [[ "$EXIT_CODE" != "0" ]]; then
    printf 'Migration task failed with exit code %s\n' "$EXIT_CODE" >&2
    exit 1
fi

#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
ECS_CLUSTER="${ECS_CLUSTER:?Set ECS_CLUSTER to your ECS cluster name}"

for service in "${ECS_API_SERVICE:?Set ECS_API_SERVICE}" \
    "${ECS_WORKER_SERVICE:?Set ECS_WORKER_SERVICE}" \
    "${ECS_WEB_SERVICE:?Set ECS_WEB_SERVICE}"; do
    aws ecs update-service \
        --region "$AWS_REGION" \
        --cluster "$ECS_CLUSTER" \
        --service "$service" \
        --force-new-deployment >/dev/null

    aws ecs wait services-stable \
        --region "$AWS_REGION" \
        --cluster "$ECS_CLUSTER" \
        --services "$service"
done

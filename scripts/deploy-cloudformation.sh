#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
STACK_NAME="${STACK_NAME:-reader-prod}"
PARAMETERS_FILE="${PARAMETERS_FILE:-infra/cloudformation/environments/prod/parameters.json}"
TEMPLATE_FILE="${TEMPLATE_FILE:-infra/cloudformation/reader-prod.yaml}"

[[ -f "$PARAMETERS_FILE" ]] || {
    printf 'Missing %s; copy parameters.example.json and fill every placeholder.\n' "$PARAMETERS_FILE" >&2
    exit 1
}

PARAMETERS_FILE_ABS="$(cd "$(dirname "$PARAMETERS_FILE")" && pwd)/$(basename "$PARAMETERS_FILE")"

aws cloudformation deploy \
    --region "$AWS_REGION" \
    --stack-name "$STACK_NAME" \
    --template-file "$TEMPLATE_FILE" \
    --parameter-overrides "file://$PARAMETERS_FILE_ABS" \
    --capabilities CAPABILITY_NAMED_IAM \
    --no-fail-on-empty-changeset

aws cloudformation describe-stacks \
    --region "$AWS_REGION" \
    --stack-name "$STACK_NAME" \
    --query 'Stacks[0].Outputs' \
    --output table

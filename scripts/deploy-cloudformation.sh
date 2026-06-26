#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
STACK_NAME="${STACK_NAME:-reader-prod}"
PARAMETERS_FILE="${PARAMETERS_FILE:-infra/cloudformation/environments/prod/parameters.json}"
TEMPLATE_FILE="${TEMPLATE_FILE:-infra/cloudformation/reader-prod.yaml}"
CFN_ARTIFACT_BUCKET="${CFN_ARTIFACT_BUCKET:-}"
CFN_ARTIFACT_PREFIX="${CFN_ARTIFACT_PREFIX:-${STACK_NAME}/templates}"

[[ -f "$PARAMETERS_FILE" ]] || {
    printf 'Missing %s; copy parameters.example.json and fill every placeholder.\n' "$PARAMETERS_FILE" >&2
    exit 1
}

[[ -n "$CFN_ARTIFACT_BUCKET" ]] || {
    printf 'Missing CFN_ARTIFACT_BUCKET; nested CloudFormation templates must be packaged to S3 before deploy.\n' >&2
    exit 1
}

PARAMETERS_FILE_ABS="$(cd "$(dirname "$PARAMETERS_FILE")" && pwd)/$(basename "$PARAMETERS_FILE")"

TEMPLATE_DIR="$(cd "$(dirname "$TEMPLATE_FILE")" && pwd)"
TEMPLATE_BASENAME="$(basename "$TEMPLATE_FILE")"
PACKAGED_TEMPLATE="$(mktemp)"
trap 'rm -f "$PACKAGED_TEMPLATE"' EXIT

(
    cd "$TEMPLATE_DIR"
    aws cloudformation package \
        --region "$AWS_REGION" \
        --template-file "$TEMPLATE_BASENAME" \
        --s3-bucket "$CFN_ARTIFACT_BUCKET" \
        --s3-prefix "$CFN_ARTIFACT_PREFIX" \
        --output-template-file "$PACKAGED_TEMPLATE"
)

aws cloudformation deploy \
    --region "$AWS_REGION" \
    --stack-name "$STACK_NAME" \
    --template-file "$PACKAGED_TEMPLATE" \
    --parameter-overrides "file://$PARAMETERS_FILE_ABS" \
    --capabilities CAPABILITY_NAMED_IAM \
    --no-fail-on-empty-changeset

aws cloudformation describe-stacks \
    --region "$AWS_REGION" \
    --stack-name "$STACK_NAME" \
    --query 'Stacks[0].Outputs' \
    --output table

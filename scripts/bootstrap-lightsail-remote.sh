#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
STACK_NAME="${STACK_NAME:-reader-prod}"
PARAMETERS_FILE="${PARAMETERS_FILE:-infra/cloudformation/environments/prod/parameters.json}"
SSH_USER="${SSH_USER:-ubuntu}"
SSH_KEY="${SSH_KEY:-}"
SSH_WAIT_ATTEMPTS="${SSH_WAIT_ATTEMPTS:-60}"
SSH_WAIT_SECONDS="${SSH_WAIT_SECONDS:-5}"

[[ -f "$PARAMETERS_FILE" ]] || {
    printf 'Missing %s; copy parameters.example.json and fill every placeholder.\n' "$PARAMETERS_FILE" >&2
    exit 1
}

stack_json="$(aws cloudformation describe-stacks \
    --region "$AWS_REGION" \
    --stack-name "$STACK_NAME" \
    --query 'Stacks[0]' \
    --output json)"

get_output() {
    local key="$1"
    STACK_JSON="$stack_json" node -e '
const stack = JSON.parse(process.env.STACK_JSON);
const key = process.argv[1];
const output = (stack.Outputs || []).find((item) => item.OutputKey === key);
if (!output || output.OutputValue == null || output.OutputValue === "") {
  process.exit(1);
}
process.stdout.write(output.OutputValue);
' "$key"
}

static_ip="$(get_output StaticIpAddress)"

ssh_args=(
    -o StrictHostKeyChecking=accept-new
    -o ServerAliveInterval=15
    -o ConnectTimeout=10
)
if [ -n "$SSH_KEY" ]; then
    ssh_args+=(-i "$SSH_KEY")
fi

target="${SSH_USER}@${static_ip}"
printf 'Waiting for SSH on %s...\n' "$target"
for attempt in $(seq 1 "$SSH_WAIT_ATTEMPTS"); do
    if ssh "${ssh_args[@]}" "$target" "true" >/dev/null 2>&1; then
        break
    fi
    if [ "$attempt" = "$SSH_WAIT_ATTEMPTS" ]; then
        printf 'SSH did not become available on %s after %s attempts.\n' "$target" "$SSH_WAIT_ATTEMPTS" >&2
        exit 1
    fi
    sleep "$SSH_WAIT_SECONDS"
done

env_file="$(mktemp)"
trap 'rm -f "$env_file"' EXIT

STACK_JSON="$stack_json" PARAMETERS_FILE="$PARAMETERS_FILE" node >"$env_file" <<'NODE'
const fs = require("fs");

const params = JSON.parse(fs.readFileSync(process.env.PARAMETERS_FILE, "utf8"));
const stack = JSON.parse(process.env.STACK_JSON);

const param = (key, fallback = "") =>
  params.find((item) => item.ParameterKey === key)?.ParameterValue ?? fallback;
const output = (key, fallback = "") =>
  (stack.Outputs || []).find((item) => item.OutputKey === key)?.OutputValue ?? fallback;
const quote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;

const values = {
  READER_DOMAIN: param("DomainName"),
  REPO_URL: param("RepoUrl"),
  REPO_BRANCH: param("RepoBranch", "main"),
  POSTGRES_USER: "reader",
  POSTGRES_PASSWORD: param("PostgresPasswordValue"),
  POSTGRES_DB: "reader",
  JWT_SECRET: param("JwtSecretValue"),
  FRONTEND_URL: `https://${param("DomainName")}`,
  API_PORT: param("AppApiPort", "3000"),
  WEB_PORT: param("AppWebPort", "3001"),
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: param("GoogleClientId"),
  GOOGLE_CLIENT_ID: param("GoogleClientId"),
  GOOGLE_CLIENT_SECRET: param("GoogleClientSecretValue"),
  OPENAI_API_KEY: param("OpenAiApiKeySecretValue"),
  S3_REGION: process.env.AWS_REGION || "us-east-1",
  S3_BUCKET_NAME: output("S3BucketName"),
  AWS_ACCESS_KEY_ID: output("S3AccessKeyId"),
  AWS_SECRET_ACCESS_KEY: output("S3SecretAccessKey"),
  LANGFUSE_PUBLIC_KEY: param("LangfusePublicKey"),
  LANGFUSE_SECRET_KEY: param("LangfuseSecretKeyValue"),
  LANGFUSE_BASE_URL: param("LangfuseBaseUrl"),
  LANGFUSE_SAMPLE_RATE: param("LangfuseSampleRate", "1"),
  LANGFUSE_CAPTURE_CONTENT: param("LangfuseCaptureContent", "metadata"),
  LANGFUSE_MAX_CAPTURE_CHARS: param("LangfuseMaxCaptureChars", "500"),
};

for (const [key, value] of Object.entries(values)) {
  if (value == null || value === "") {
    if (["LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_BASE_URL"].includes(key)) {
      console.log(`${key}=`);
      continue;
    }
    throw new Error(`Missing bootstrap value for ${key}`);
  }
  console.log(`${key}=${quote(value)}`);
}
NODE

printf 'Uploading bootstrap environment to %s...\n' "$target"
scp "${ssh_args[@]}" "$env_file" "$target:/tmp/reader-bootstrap.env"

printf 'Running Reader bootstrap on %s...\n' "$target"
ssh "${ssh_args[@]}" "$target" 'bash -s' <<'REMOTE'
set -euo pipefail

sudo install -d -m 0755 /opt
sudo apt-get update -o Acquire::Retries=5
sudo apt-get install -y ca-certificates git

set -a
. /tmp/reader-bootstrap.env
set +a

sudo install -d -o "$USER" -g "$USER" /opt/reader
if [ ! -d /opt/reader/.git ]; then
    git clone --branch "$REPO_BRANCH" --single-branch "$REPO_URL" /opt/reader
else
    git -C /opt/reader fetch origin "$REPO_BRANCH"
    git -C /opt/reader checkout "$REPO_BRANCH"
    git -C /opt/reader pull --ff-only origin "$REPO_BRANCH"
fi

cd /opt/reader
sudo -E bash scripts/bootstrap-lightsail-instance.sh
REMOTE

printf 'Reader bootstrap completed on %s.\n' "$target"

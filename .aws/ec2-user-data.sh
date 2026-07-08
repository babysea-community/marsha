#!/bin/bash
set -euo pipefail
umask 077

APP_IMAGE_URI="__APP_IMAGE_URI__"
APP_PARAMETER_PREFIX="__APP_PARAMETER_PREFIX__"
APP_SITE_URL="__APP_SITE_URL__"
APP_AWS_REGION="__APP_AWS_REGION__"
APP_CONTAINER_PORT="${APP_CONTAINER_PORT:-3000}"
APP_HOST_PORT="${APP_HOST_PORT:-80}"

log() {
  printf '[marsha-ec2] %s\n' "$*"
}

if [[ "$APP_IMAGE_URI" == "__APP_IMAGE_URI__" ]] || \
  [[ "$APP_PARAMETER_PREFIX" == "__APP_PARAMETER_PREFIX__" ]] || \
  [[ "$APP_SITE_URL" == "__APP_SITE_URL__" ]] || \
  [[ "$APP_AWS_REGION" == "__APP_AWS_REGION__" ]]; then
  log 'Render .aws/ec2-user-data.sh placeholders before passing it to EC2 user data.'
  exit 1
fi

APP_PARAMETER_PREFIX="${APP_PARAMETER_PREFIX%/}"
APP_HOME=/opt/marsha
APP_ENV_FILE="$APP_HOME/marsha.env"
APP_ENV_TMP="$APP_HOME/marsha.env.tmp"
APP_PARAMETERS_FILE="$APP_HOME/parameters.json"

cleanup_temp_files() {
  rm -f "$APP_ENV_TMP" "$APP_PARAMETERS_FILE"
}

trap cleanup_temp_files EXIT

log 'Installing runtime packages.'
dnf update -y
dnf install -y awscli curl docker jq

log 'Starting Docker.'
systemctl enable --now docker

install -d -m 0700 "$APP_HOME"

log 'Loading Marsha parameters from AWS Systems Manager Parameter Store.'
aws ssm get-parameters-by-path \
  --region "$APP_AWS_REGION" \
  --path "$APP_PARAMETER_PREFIX" \
  --with-decryption \
  --recursive \
  --output json >"$APP_PARAMETERS_FILE"

if jq -e '.Parameters[] | select(.Value | test("[\\r\\n]"))' \
  "$APP_PARAMETERS_FILE" >/dev/null; then
  log 'SSM parameters for EC2 must be single-line values. Use comma-separated API keys.'
  exit 1
fi

jq -r '.Parameters[] | "\(.Name | split("/")[-1])=\(.Value)"' \
  "$APP_PARAMETERS_FILE" >"$APP_ENV_TMP"

parameter_value() {
  local key="$1"
  awk -F= -v key="$key" \
    '$1 == key { sub(/^[^=]*=/, ""); print; found=1; exit } END { if (!found) exit 1 }' \
    "$APP_ENV_TMP"
}

write_env_value() {
  local key="$1"
  local value="$2"
  printf '%s=%s\n' "$key" "$value" >>"$APP_ENV_FILE"
}

write_parameter_value() {
  local key="$1"
  local default_value="${2:-}"
  local value

  value="$(parameter_value "$key" || true)"
  write_env_value "$key" "${value:-$default_value}"
}

: >"$APP_ENV_FILE"
write_env_value NEXT_PUBLIC_SITE_URL "$APP_SITE_URL"
write_parameter_value OWNER_EMAIL
write_parameter_value OWNER_PASSWORD
write_parameter_value OWNER_SESSION_SECRET
write_parameter_value APP_DATABASE aurora
write_parameter_value DATABASE_URL
write_parameter_value APP_API_KEY
write_parameter_value APP_CRON_SECRET
write_parameter_value APP_CALLBACK_SECRET
write_parameter_value APP_PROVIDER_MODE byok
write_parameter_value DASHSCOPE_API_KEY
write_parameter_value BFL_API_KEY
write_parameter_value BFL_REGION global
write_parameter_value BFL_API_BASE_URL https://api.bfl.ai/v1
write_parameter_value ARK_API_KEY
write_parameter_value GEMINI_API_KEY
write_parameter_value OPENAI_API_KEY
write_parameter_value RUNWAYML_API_SECRET
write_parameter_value BABYSEA_API_KEY
write_parameter_value BABYSEA_REGION us
write_parameter_value BABYSEA_API_BASE_URL https://api.us.babysea.ai
write_parameter_value BABYSEA_WEBHOOK_SECRET
write_parameter_value AGENT_CHAIN_AWS_BEDROCK_TOKEN
write_parameter_value AGENT_CHAIN_AWS_BEDROCK_REGION us-east-1
write_parameter_value AGENT_CHAIN_AWS_BEDROCK_AGENT us.amazon.nova-2-lite-v1:0
write_parameter_value APP_STORAGE_PROVIDER none
write_parameter_value ALIBABA_CLOUD_OSS_REGION
write_parameter_value ALIBABA_CLOUD_OSS_ACCESS_KEY_ID
write_parameter_value ALIBABA_CLOUD_OSS_ACCESS_KEY_SECRET
write_parameter_value ALIBABA_CLOUD_OSS_BUCKET_NAME
write_parameter_value ALIBABA_CLOUD_OSS_ENDPOINT
write_parameter_value ALIBABA_CLOUD_OSS_PUBLIC_BASE_URL
write_parameter_value AWS_S3_REGION
write_parameter_value AWS_S3_ACCESS_KEY_ID
write_parameter_value AWS_S3_SECRET_ACCESS_KEY
write_parameter_value AWS_S3_BUCKET_NAME
write_parameter_value AWS_S3_ENDPOINT_URL
write_parameter_value HUGGINGFACE_STORAGE_NAMESPACE
write_parameter_value HUGGINGFACE_STORAGE_ACCESS_KEY_ID
write_parameter_value HUGGINGFACE_STORAGE_SECRET_ACCESS_KEY
write_parameter_value HUGGINGFACE_STORAGE_BUCKET_NAME
write_parameter_value HUGGINGFACE_STORAGE_PUBLIC_BASE_URL
write_parameter_value MINIO_ENDPOINT_URL
write_parameter_value MINIO_ACCESS_KEY_ID
write_parameter_value MINIO_SECRET_ACCESS_KEY
write_parameter_value MINIO_BUCKET_NAME
write_parameter_value MINIO_REGION us-east-1
write_parameter_value MINIO_PUBLIC_BASE_URL
write_parameter_value SCALEWAY_OBJECT_STORAGE_REGION
write_parameter_value SCALEWAY_OBJECT_STORAGE_ACCESS_KEY_ID
write_parameter_value SCALEWAY_OBJECT_STORAGE_SECRET_ACCESS_KEY
write_parameter_value SCALEWAY_OBJECT_STORAGE_BUCKET_NAME
write_parameter_value SCALEWAY_OBJECT_STORAGE_ENDPOINT_URL
write_parameter_value SCALEWAY_OBJECT_STORAGE_PUBLIC_BASE_URL
write_parameter_value SPACES_REGION
write_parameter_value SPACES_ACCESS_KEY_ID
write_parameter_value SPACES_SECRET_ACCESS_KEY
write_parameter_value SPACES_BUCKET_NAME
write_parameter_value SPACES_ENDPOINT_URL
write_parameter_value SPACES_PUBLIC_BASE_URL
write_parameter_value BLOB_READ_WRITE_TOKEN
write_parameter_value NEXT_PUBLIC_SENTRY_DSN
write_parameter_value NEXT_PUBLIC_SENTRY_ENVIRONMENT production
write_parameter_value SENTRY_ORG
write_parameter_value SENTRY_PROJECT
write_env_value HOSTNAME 0.0.0.0
write_env_value PORT "$APP_CONTAINER_PORT"
write_env_value NODE_ENV production

chmod 0600 "$APP_ENV_FILE"
cleanup_temp_files

env_value() {
  local key="$1"
  awk -F= -v key="$key" \
    '$1 == key { sub(/^[^=]*=/, ""); print; found=1; exit } END { if (!found) exit 1 }' \
    "$APP_ENV_FILE"
}

require_env_value() {
  local key="$1"
  local value

  if ! value="$(env_value "$key")" || [[ -z "$value" ]]; then
    log "Missing required SSM parameter $APP_PARAMETER_PREFIX/$key."
    exit 1
  fi
}

for required_name in \
  OWNER_EMAIL \
  OWNER_PASSWORD \
  OWNER_SESSION_SECRET \
  DATABASE_URL \
  APP_API_KEY \
  APP_CRON_SECRET \
  APP_CALLBACK_SECRET; do
  require_env_value "$required_name"
done

provider_mode="$(env_value APP_PROVIDER_MODE || true)"
provider_mode="${provider_mode:-byok}"

case "$provider_mode" in
  byok)
    if [[ -z "$(env_value DASHSCOPE_API_KEY || true)" ]] && \
      [[ -z "$(env_value BFL_API_KEY || true)" ]] && \
      [[ -z "$(env_value ARK_API_KEY || true)" ]] && \
      [[ -z "$(env_value GEMINI_API_KEY || true)" ]] && \
      [[ -z "$(env_value OPENAI_API_KEY || true)" ]] && \
      [[ -z "$(env_value RUNWAYML_API_SECRET || true)" ]]; then
      log 'APP_PROVIDER_MODE=byok requires at least one provider key: DASHSCOPE_API_KEY, BFL_API_KEY, ARK_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, or RUNWAYML_API_SECRET.'
      exit 1
    fi
    ;;
  babysea)
    require_env_value BABYSEA_API_KEY
    require_env_value BABYSEA_API_BASE_URL
    ;;
  *)
    log "Unsupported APP_PROVIDER_MODE: $provider_mode."
    exit 1
    ;;
esac

registry="${APP_IMAGE_URI%%/*}"
if [[ "$registry" == *.dkr.ecr.*.amazonaws.com ]]; then
  log "Logging in to ECR registry $registry."
  aws ecr get-login-password --region "$APP_AWS_REGION" | \
    docker login --username AWS --password-stdin "$registry"
fi

log "Pulling $APP_IMAGE_URI."
docker pull "$APP_IMAGE_URI"

docker rm -f marsha >/dev/null 2>&1 || true

log 'Starting Marsha container.'
docker run \
  --detach \
  --name marsha \
  --restart unless-stopped \
  --env-file "$APP_ENV_FILE" \
  --publish "$APP_HOST_PORT:$APP_CONTAINER_PORT" \
  "$APP_IMAGE_URI"

cat >"$APP_HOME/process-runs.sh" <<SCRIPT
#!/bin/bash
set -euo pipefail

ENV_FILE=$APP_ENV_FILE
CRON_SECRET="\$(awk -F= '\$1 == "APP_CRON_SECRET" { sub(/^[^=]*=/, ""); print; exit }' "\$ENV_FILE")"
CRON_LIMIT="\$(awk -F= '\$1 == "APP_CRON_LIMIT" { sub(/^[^=]*=/, ""); print; exit }' "\$ENV_FILE")"
CRON_LIMIT="\${CRON_LIMIT:-5}"

if [[ -z "\$CRON_SECRET" ]]; then
  echo 'APP_CRON_SECRET is missing from the EC2 env file.' >&2
  exit 1
fi

curl -fsS \
  -H "Authorization: Bearer \$CRON_SECRET" \
  "http://127.0.0.1:$APP_HOST_PORT/api/cron/process-runs?limit=\$CRON_LIMIT"
SCRIPT

chmod 0755 "$APP_HOME/process-runs.sh"

cat >/etc/systemd/system/marsha-cron.service <<'UNIT'
[Unit]
Description=Run Marsha queued-run recovery once
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/opt/marsha/process-runs.sh
UNIT

cat >/etc/systemd/system/marsha-cron.timer <<'UNIT'
[Unit]
Description=Run Marsha queued-run recovery every five minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
RandomizedDelaySec=30s
Unit=marsha-cron.service

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now marsha-cron.timer

log 'Marsha EC2 bootstrap complete.'

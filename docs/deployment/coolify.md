# Deploy Marsha with Coolify

Coolify can deploy from the production `Dockerfile` or from the included `docker-compose.yml`. The compose file is recommended because it keeps the build args, runtime environment, port mapping, restart policy, and healthcheck in one place.

## Prerequisites

- A Coolify instance connected to your Git provider.
- A reachable PostgreSQL database, preferably Aurora/RDS for production.
- The schema applied with `pnpm run db:migrate` against `DATABASE_URL`.
- BYOK provider credentials. Default deployments use `APP_PROVIDER_MODE=byok`, so set the provider keys required by the models you plan to run. The example below uses `GEMINI_API_KEY` for Google models.
- Optional BabySea credentials only if you switch `APP_PROVIDER_MODE` to `babysea`.
- A public domain selected before the first build, for example `https://your-domain.example.com`.

### 1. Create the Coolify resource

1. Create a new **Application** in Coolify.
2. Select the repository and the starter directory.
3. Choose **Docker Compose** as the build pack.
4. Set the compose file path to `docker-compose.yml`.
5. Set the public domain to your final `NEXT_PUBLIC_SITE_URL`.

The compose service exposes port `3000`, maps it through `APP_HOST_PORT`, and includes a healthcheck for `/api/health`.

### 2. Set build and runtime variables

Coolify passes variables to both the Docker build and the running container. Add these values in the application environment screen:

```bash
NEXT_PUBLIC_SITE_URL=https://your-domain.example.com
OWNER_EMAIL=owner@example.com
OWNER_PASSWORD=YOUR_OWNER_PASSWORD
OWNER_SESSION_SECRET=YOUR_OWNER_SESSION_SECRET
APP_DATABASE=aurora
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/postgres?sslmode=require
APP_API_KEY=YOUR_APP_API_KEY
APP_CRON_SECRET=YOUR_APP_CRON_SECRET
APP_CALLBACK_SECRET=YOUR_APP_CALLBACK_SECRET
APP_PROVIDER_MODE=byok
DASHSCOPE_API_KEY=YOUR_DASHSCOPE_API_KEY
BFL_API_KEY=YOUR_BFL_API_KEY
BFL_REGION=global
BFL_API_BASE_URL=https://api.bfl.ai/v1
ARK_API_KEY=YOUR_ARK_API_KEY
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
OPENAI_API_KEY=YOUR_OPENAI_API_KEY
RUNWAYML_API_SECRET=YOUR_RUNWAY_API_KEY
BABYSEA_API_KEY=YOUR_BABYSEA_API_KEY_OR_PLACEHOLDER
BABYSEA_REGION=us
BABYSEA_API_BASE_URL=https://api.us.babysea.ai
BABYSEA_WEBHOOK_SECRET=YOUR_BABYSEA_WEBHOOK_SECRET_OR_PLACEHOLDER
AGENT_CHAIN_AWS_BEDROCK_TOKEN=
AGENT_CHAIN_AWS_BEDROCK_REGION=us-east-1
AGENT_CHAIN_AWS_BEDROCK_AGENT=us.amazon.nova-2-lite-v1:0
APP_STORAGE_PROVIDER=none
ALIBABA_CLOUD_OSS_REGION=
ALIBABA_CLOUD_OSS_ACCESS_KEY_ID=
ALIBABA_CLOUD_OSS_ACCESS_KEY_SECRET=
ALIBABA_CLOUD_OSS_BUCKET_NAME=
ALIBABA_CLOUD_OSS_ENDPOINT=
ALIBABA_CLOUD_OSS_PUBLIC_BASE_URL=
AWS_S3_REGION=
AWS_S3_ACCESS_KEY_ID=
AWS_S3_SECRET_ACCESS_KEY=
AWS_S3_BUCKET_NAME=
AWS_S3_ENDPOINT_URL=
BACKBLAZE_B2_KEY_ID=
BACKBLAZE_B2_APPLICATION_KEY=
BACKBLAZE_B2_BUCKET_NAME=
BACKBLAZE_B2_BUCKET_ID=
BACKBLAZE_B2_PUBLIC_BASE_URL=
CLOUDFLARE_R2_ACCOUNT_ID=
CLOUDFLARE_R2_ACCESS_KEY_ID=
CLOUDFLARE_R2_SECRET_ACCESS_KEY=
CLOUDFLARE_R2_BUCKET_NAME=
CLOUDFLARE_R2_ENDPOINT_URL=
CLOUDFLARE_R2_CUSTOM_DOMAIN_URL=
HUGGINGFACE_STORAGE_NAMESPACE=
HUGGINGFACE_STORAGE_ACCESS_KEY_ID=
HUGGINGFACE_STORAGE_SECRET_ACCESS_KEY=
HUGGINGFACE_STORAGE_BUCKET_NAME=
HUGGINGFACE_STORAGE_PUBLIC_BASE_URL=
MINIO_ENDPOINT_URL=
MINIO_ACCESS_KEY_ID=
MINIO_SECRET_ACCESS_KEY=
MINIO_BUCKET_NAME=
MINIO_REGION=us-east-1
MINIO_PUBLIC_BASE_URL=
SCALEWAY_OBJECT_STORAGE_REGION=
SCALEWAY_OBJECT_STORAGE_ACCESS_KEY_ID=
SCALEWAY_OBJECT_STORAGE_SECRET_ACCESS_KEY=
SCALEWAY_OBJECT_STORAGE_BUCKET_NAME=
SCALEWAY_OBJECT_STORAGE_ENDPOINT_URL=
SCALEWAY_OBJECT_STORAGE_PUBLIC_BASE_URL=
SPACES_REGION=
SPACES_ACCESS_KEY_ID=
SPACES_SECRET_ACCESS_KEY=
SPACES_BUCKET_NAME=
SPACES_ENDPOINT_URL=
SPACES_PUBLIC_BASE_URL=
BLOB_READ_WRITE_TOKEN=
NEXT_PUBLIC_SENTRY_DSN=https://example@sentry.io/123
NEXT_PUBLIC_SENTRY_ENVIRONMENT=production
SENTRY_ORG=YOUR_SENTRY_ORG
SENTRY_PROJECT=YOUR_SENTRY_PROJECT
```

Unused BYOK provider keys can stay blank as long as you do not select those providers' models. The BabySea and Sentry values can be placeholders when you stay in BYOK mode and do not upload source maps. Keep `SENTRY_AUTH_TOKEN` in CI or your build environment only when you intentionally upload source maps; it is not needed by the running container. For BabySea mode, change `APP_PROVIDER_MODE` to `babysea` and replace the BabySea placeholders with real values.

### 3. Deploy

Trigger a Coolify deployment. Coolify will build the Docker image with:

- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_SENTRY_DSN`
- `NEXT_PUBLIC_SENTRY_ENVIRONMENT`

After deployment, open the configured domain and confirm the application responds.

### 4. Add the recovery schedule

It processes runs immediately after creation, but Coolify deployments should still run the recovery endpoint periodically.

In Coolify, add a scheduled task for the application container:

```bash
curl -fsS \
  -H "Authorization: Bearer $APP_CRON_SECRET" \
  "$NEXT_PUBLIC_SITE_URL/api/cron/process-runs?limit=5"
```

Run it every 1 to 5 minutes. The endpoint is idempotent and only picks up eligible pending runs.

### 5. Verify locally with Docker Compose

Before pushing changes to Coolify, you can test the same compose file locally:

```bash
cp .env.example .env.local
docker compose --env-file .env.local config
docker compose --env-file .env.local up --build
```

Then verify the API:

```bash
curl -fsS \
  -H "Authorization: Bearer YOUR_APP_API_KEY" \
  http://localhost:3000/api/health
```

## Troubleshooting

- If public URLs are wrong in the browser, update `NEXT_PUBLIC_SITE_URL` and redeploy so Next.js rebuilds.
- If Coolify reports an unhealthy container, check the logs and confirm the container listens on port `3000`.
- If run recovery does not work, confirm the scheduled task sends `Authorization: Bearer $APP_CRON_SECRET`.
- If provider calls fail, confirm `APP_PROVIDER_MODE` matches the secrets in the Coolify environment.

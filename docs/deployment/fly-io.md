# Deploy Marsha on Fly.io

Fly.io runs from the production `Dockerfile` in this starter. Use this guide when you want a long-running Docker deployment with Fly-managed TLS and regional placement.

## Prerequisites

- A Fly.io account and the `flyctl` CLI installed.
- A reachable PostgreSQL database, preferably Aurora/RDS for production.
- The schema applied with `pnpm run db:migrate` against `DATABASE_URL`.
- BYOK provider credentials. Default deployments use `APP_PROVIDER_MODE=byok`, so set the provider keys required by the models you plan to run. The example below uses `GEMINI_API_KEY` for Google models.
- Optional BabySea credentials only if you switch `APP_PROVIDER_MODE` to `babysea`.
- A public app URL selected before the first build, for example `https://marsha.fly.dev` or a custom domain.

### 1. Create the Fly app

From this starter directory:

```bash
fly launch --no-deploy --copy-config --name marsha
```

The starter includes `fly.toml` with:

- `internal_port = 3000`
- `force_https = true`
- `min_machines_running = 1`
- `auto_stop_machines = false`

Change `app` and `primary_region` in `fly.toml` before deploying if you want a different app name or region.

### 2. Set runtime secrets

Set deployment-specific runtime values and secrets in Fly; do not commit them. The starter's non-secret defaults stay in `fly.toml` under `[env]`.

```bash
fly secrets set \
  NEXT_PUBLIC_SITE_URL="https://marsha.fly.dev" \
  OWNER_EMAIL="owner@example.com" \
  OWNER_PASSWORD="YOUR_OWNER_PASSWORD" \
  OWNER_SESSION_SECRET="YOUR_OWNER_SESSION_SECRET" \
  DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/postgres?sslmode=require" \
  APP_API_KEY="YOUR_APP_API_KEY" \
  APP_CRON_SECRET="YOUR_APP_CRON_SECRET" \
  APP_CALLBACK_SECRET="YOUR_APP_CALLBACK_SECRET" \
  DASHSCOPE_API_KEY="YOUR_DASHSCOPE_API_KEY" \
  BFL_API_KEY="YOUR_BFL_API_KEY" \
  ARK_API_KEY="YOUR_ARK_API_KEY" \
  GEMINI_API_KEY="YOUR_GEMINI_API_KEY" \
  OPENAI_API_KEY="YOUR_OPENAI_API_KEY" \
  RUNWAYML_API_SECRET="YOUR_RUNWAY_API_KEY" \
  BABYSEA_API_KEY="YOUR_BABYSEA_API_KEY_OR_PLACEHOLDER" \
  BABYSEA_WEBHOOK_SECRET="YOUR_BABYSEA_WEBHOOK_SECRET_OR_PLACEHOLDER" \
  AGENT_CHAIN_AWS_BEDROCK_TOKEN="" \
  ALIBABA_CLOUD_OSS_ACCESS_KEY_ID="" \
  ALIBABA_CLOUD_OSS_ACCESS_KEY_SECRET="" \
  AWS_S3_ACCESS_KEY_ID="" \
  AWS_S3_SECRET_ACCESS_KEY="" \
  HUGGINGFACE_STORAGE_ACCESS_KEY_ID="" \
  HUGGINGFACE_STORAGE_SECRET_ACCESS_KEY="" \
  MINIO_ACCESS_KEY_ID="" \
  MINIO_SECRET_ACCESS_KEY="" \
  SCALEWAY_OBJECT_STORAGE_ACCESS_KEY_ID="" \
  SCALEWAY_OBJECT_STORAGE_SECRET_ACCESS_KEY="" \
  SPACES_ACCESS_KEY_ID="" \
  SPACES_SECRET_ACCESS_KEY="" \
  BLOB_READ_WRITE_TOKEN="" \
  NEXT_PUBLIC_SENTRY_DSN=""
```

Unused BYOK provider keys can stay blank as long as you do not select those providers' models. The BabySea and Sentry values can be placeholders when you stay in BYOK mode and do not upload source maps. Keep `SENTRY_AUTH_TOKEN` in CI or your build environment only when you intentionally upload source maps; it is not needed by the running container. For BabySea mode, change `APP_PROVIDER_MODE` to `babysea` and replace the BabySea placeholders with real values.

Media storage (`ALIBABA_CLOUD_OSS_*`, `AWS_S3_*`, `BACKBLAZE_B2_*`, `CLOUDFLARE_R2_*`, `HUGGINGFACE_STORAGE_*`, `MINIO_*`, `SCALEWAY_OBJECT_STORAGE_*`, `SPACES_*`, `BLOB_READ_WRITE_TOKEN`) and the Agentic Workflow planner (`AGENT_CHAIN_AWS_BEDROCK_TOKEN`) are optional: leave those secrets blank to run without them. Non-secret defaults such as `APP_DATABASE`, `APP_PROVIDER_MODE`, `BFL_REGION`, `BFL_API_BASE_URL`, `BABYSEA_REGION`, `BABYSEA_API_BASE_URL`, `AGENT_CHAIN_AWS_BEDROCK_REGION`, `AGENT_CHAIN_AWS_BEDROCK_AGENT`, `APP_STORAGE_PROVIDER`, and `NEXT_PUBLIC_SENTRY_ENVIRONMENT` live in `fly.toml` under `[env]`; set `APP_STORAGE_PROVIDER` to `alibaba-cloud-oss`, `aws-s3`, `backblaze-b2`, `cloudflare-r2`, `huggingface-storage-buckets`, `minio`, `scaleway-object-storage`, `spaces-object-storage`, or `vercel-blob` to enable storage. Add non-secret storage values such as bucket names, endpoint URLs, public base URLs, account IDs, regions, and Hugging Face namespaces to `fly.toml` too, so they do not override later config edits as Fly secrets.

### 3. Deploy with build args

Next.js bakes public variables into the build, so pass the public URL during `fly deploy` too.

```bash
fly deploy \
  --build-arg NEXT_PUBLIC_SITE_URL="https://marsha.fly.dev" \
  --build-arg NEXT_PUBLIC_SENTRY_ENVIRONMENT="production"
```

If you use a custom domain, update the secret and redeploy with the same URL:

```bash
fly certs add your-app.example.com
fly secrets set NEXT_PUBLIC_SITE_URL="https://your-domain.example.com"
fly deploy \
  --build-arg NEXT_PUBLIC_SITE_URL="https://your-domain.example.com"
```

### 4. Schedule run recovery

It processes runs immediately after creation, but non-Vercel hosts still need a periodic recovery call for interrupted or queued work.

Use an external scheduler that can send an HTTP header every 1 to 5 minutes:

```bash
curl -fsS \
  -H "Authorization: Bearer YOUR_APP_CRON_SECRET" \
  "https://marsha.fly.dev/api/cron/process-runs?limit=5"
```

Set the schedule to every minute for high-volume deployments, or every five minutes for low-volume deployments. The route is idempotent and only processes eligible pending runs.

### 5. Verify the deployment

```bash
fly status
fly logs
curl -fsS \
  -H "Authorization: Bearer YOUR_APP_API_KEY" \
  https://marsha.fly.dev/api/health
```

To validate locally before deploying:

```bash
pnpm run doctor
```

## Troubleshooting

- If the app starts but the browser shows stale public URLs, redeploy with the correct `NEXT_PUBLIC_SITE_URL` build arg.
- If run creation works but processing stalls, check the external scheduler and `APP_CRON_SECRET` header.
- If provider calls fail, confirm `APP_PROVIDER_MODE` matches the provider secrets you set.
- If machines stop between requests, keep `auto_stop_machines = false` and `min_machines_running = 1` in `fly.toml`.

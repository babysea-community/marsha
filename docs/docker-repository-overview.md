# Marsha

Marsha is a self-hosted canvas studio and durable HTTP API for chaining image and video generation models. Design image-to-video workflows visually, run them from the dashboard, or call the same production API from your own application. Marsha keeps provider credentials server-side, stores run state in PostgreSQL/Aurora, and sends one signed callback when the final result is ready.

## Image

```bash
docker pull babyseaoss/marsha:latest
```

Available tags:

- `latest`
- `0.1.0`

## Quick start

Create an environment file from the `.env.example` and fill at least:

- `NEXT_PUBLIC_SITE_URL`
- `OWNER_EMAIL`
- `OWNER_PASSWORD`
- `OWNER_SESSION_SECRET`
- `APP_DATABASE`
- `DATABASE_URL`
- `APP_API_KEY`
- `APP_CRON_SECRET`
- `APP_CALLBACK_SECRET`
- Inference provider keys if you use BYOK-mode (Alibaba Cloud, Black Forest Labs, BytePlus, Google, OpenAI, Runway)
- BabySea keys if you use BabySea-mode
- Amazon Bedrock keys if you use Agentic Workflow (Amazon Nova)
- Storage provider keys if you use storage (Alibaba Cloud OSS, AWS S3, Backblaze B2, Cloudflare R2, Hugging Face Storage Buckets, MinIO, Scaleway Object Storage, Spaces Object Storage, Vercel Blob)

<br/>

Then run:

```bash
docker run --rm \
  --name marsha \
  --env-file .env.local \
  -p 3000:3000 \
  babyseaoss/marsha:latest
```

Open:

```text
http://localhost:3000
```

The published `latest` image is built for local use at `http://localhost:3000`. For a production domain, build your own image with the final public URL:

```bash
docker build \
  --build-arg NEXT_PUBLIC_SITE_URL="https://your-domain.example.com" \
  -t marsha:production .
```

## Health check

The image exposes port `3000` and includes a container health check against:

```text
/api/health
```

You can verify manually:

```bash
curl -fsS http://localhost:3000/api/health
```

## Runtime requirements

Requires a reachable PostgreSQL database. AWS Aurora PostgreSQL is the recommended production database. Apply the schema before the first real run:

```bash
pnpm run db:migrate
```

For long-running deployments, schedule queued-run recovery by calling:

```text
GET /api/cron/process-runs
```

with:

```text
Authorization: Bearer APP_CRON_SECRET
```

## Security notes

- Runs as the non-root `node` user.
- Based on `node:24-alpine`.
- Does not ship npm/npx in the final runtime image.
- Provider credentials stay server-side.
- Caller applications authenticate with Marsha API keys.
- `SENTRY_AUTH_TOKEN` is only needed in CI/build environments for optional source map uploads, not at runtime.

## Links

- Website: https://marsha.babysea.live
- Docker Hub: https://hub.docker.com/r/babyseaoss/marsha
- Source: https://github.com/babysea-community/marsha
- Supported models: https://github.com/babysea-community/marsha/blob/main/SUPPORTED_MODELS.md
- Docker deployment guide: https://github.com/babysea-community/marsha/blob/main/docs/deployment/docker.md

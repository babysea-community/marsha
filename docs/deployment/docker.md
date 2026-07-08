# Deploy Marsha with Docker

Docker is the portable deployment path. You can pull the published `babyseaoss/marsha` image for local evaluation or build the Dockerfile yourself with your final public Next.js values for production.

Use this guide when you want to run on any Docker-capable host or publish a reusable image from GitHub Actions.

## What this uses

- [`Dockerfile`](../../Dockerfile) builds a production Next.js image on `node:24-alpine`.
- [`.dockerignore`](../../.dockerignore) keeps local build output, dependencies, logs, and env files out of the build context.
- [`docker-compose.yml`](../../docker-compose.yml) runs `babyseaoss/marsha:latest` by default and can still build from source with `docker compose up --build`.
- [`.github/workflows/docker.yml`](../../.github/workflows/docker.yml) builds pull requests and can publish main or tag images to Docker Hub.
- The final image runs as the non-root `node` user and exposes port `3000`.

## Prerequisites

- Docker installed and running on the machine that builds the image.
- Runtime values from [`.env.example`](../../.env.example).
- A reachable PostgreSQL database, preferably Aurora/RDS for production.
- The schema applied with `pnpm run db:migrate` against `DATABASE_URL`.
- Provider keys required by your provider mode.

## Build-time values and runtime secrets

Next.js reads `NEXT_PUBLIC_*` values at build time. The published Docker Hub image is built for local use at `http://localhost:3000`. For a production domain, build your own image with the final public URL before sending real callback URLs, browser traffic, or bearer tokens through the deployment.

- Local test: `NEXT_PUBLIC_SITE_URL=http://localhost:3000`
- Production: `NEXT_PUBLIC_SITE_URL=https://your-domain.example.com`

Runtime secrets must be provided when the container starts, not as Docker build args. Keep these in `.env.local`, your host secret manager, or your orchestrator:

```dotenv
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
NEXT_PUBLIC_SENTRY_DSN=
NEXT_PUBLIC_SENTRY_ENVIRONMENT=production
SENTRY_ORG=YOUR_SENTRY_ORG
SENTRY_PROJECT=YOUR_SENTRY_PROJECT
```

Default deployments use `APP_PROVIDER_MODE=byok`, so fill the provider keys required by the models you plan to run. Unused BYOK provider keys can stay blank as long as you do not select those providers' models. The BabySea and Sentry values can be placeholders when you stay in BYOK mode and do not upload source maps. Keep `SENTRY_AUTH_TOKEN` in CI or your build environment only when you intentionally upload source maps; it is not needed by the running container.

### 1. Prepare an ENV file

```bash
cp .env.example .env.local
```

Fill `.env.local` with real runtime values. Keep `NEXT_PUBLIC_SITE_URL` in the env file too, but still pass it as a build arg so the client bundle is built for the right deployment. Before first run, apply the schema to the configured database:

```bash
pnpm run db:migrate
```

### 2. Pull the published image

For local evaluation, pull the public image:

```bash
docker pull babyseaoss/marsha:latest
```

The published `latest` tag is built for `http://localhost:3000`. You can use it with a local env file and port `3000` immediately.

### 3. Run the published image

```bash
docker run --rm \
	--name marsha \
	--env-file .env.local \
	-p 3000:3000 \
	babyseaoss/marsha:latest
```

Open <http://localhost:3000>.

For a long-running host, use a restart policy and a production env file:

```bash
docker run --detach \
	--name marsha \
	--restart unless-stopped \
	--env-file /etc/marsha.env \
	-p 3000:3000 \
	babyseaoss/marsha:latest
```

### 4. Or build for your production URL

```bash
export NEXT_PUBLIC_SITE_URL=https://your-domain.example

docker build \
	--build-arg NEXT_PUBLIC_SITE_URL="$NEXT_PUBLIC_SITE_URL" \
	-t marsha:local .
```

If you use Sentry client telemetry, also pass `NEXT_PUBLIC_SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_ENVIRONMENT` as build args.

Run the locally built image:

```bash
docker run --rm \
	--name marsha \
	--env-file .env.local \
	-e NEXT_PUBLIC_SITE_URL="$NEXT_PUBLIC_SITE_URL" \
	-p 3000:3000 \
	marsha:local
```

### 5. Docker Compose

The compose file uses `babyseaoss/marsha:latest` by default:

```bash
docker compose --env-file .env.local up
```

To build from this checkout instead, run:

```bash
docker compose --env-file .env.local up --build
```

### 6. Add HTTPS and a stable URL

The container serves HTTP. For production, put TLS in front with a reverse proxy, load balancer, Cloudflare Tunnel, or another managed ingress. Rebuild the image with the final HTTPS `NEXT_PUBLIC_SITE_URL` before sending real callback URLs, browser traffic, or bearer tokens through the deployment.

### 7. Schedule queued-run recovery

Docker does not read Vercel Cron. Run an external scheduler every few minutes to call `GET /api/cron/process-runs` with `Authorization: Bearer APP_CRON_SECRET`.

Example host cron entry:

```cron
*/5 * * * * . /etc/marsha.env && curl -fsS -H "Authorization: Bearer $APP_CRON_SECRET" "$NEXT_PUBLIC_SITE_URL/api/cron/process-runs?limit=5" >/dev/null
```

If your host uses systemd, create a timer that runs the same curl command. Keep `APP_CRON_SECRET` in a root-readable env file or host secret manager.

### 8. Publish from GitHub actions

[`.github/workflows/docker.yml`](../../.github/workflows/docker.yml) uses `docker/metadata-action`, `docker/login-action`, `docker/setup-buildx-action`, and `docker/build-push-action`.

Configure the repository before expecting pushes:

| Name                             | Type                | Purpose                                                     |
| :------------------------------- | :------------------ | :---------------------------------------------------------- |
| `DOCKER_IMAGE`                   | Repository variable | Optional full image name. Defaults to `babyseaoss/marsha`.  |
| `DOCKER_USERNAME`                | Repository variable | Docker Hub username or organization account used for login. |
| `DOCKER_PASSWORD`                | Repository secret   | Docker Hub token or password used by `docker/login-action`. |
| `NEXT_PUBLIC_SITE_URL`           | Repository variable | Public URL baked into the Next.js image.                    |
| `NEXT_PUBLIC_SENTRY_DSN`         | Repository variable | Optional public Sentry DSN.                                 |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | Repository variable | Optional public Sentry environment.                         |

Pull requests build without pushing. Main branch and `v*` tags push only when both Docker Hub credentials are configured. Main pushes publish `latest`, the `package.json` version, and a `sha-*` tag. Version tags also publish semver tags. The workflow attaches SBOM plus provenance attestations.

Manual Docker Hub publish from a trusted local checkout uses the same image name:

```bash
docker build \
	--build-arg NEXT_PUBLIC_SITE_URL="http://localhost:3000" \
	-t babyseaoss/marsha:0.4.1 \
	-t babyseaoss/marsha:latest .

docker push babyseaoss/marsha:0.4.1
docker push babyseaoss/marsha:latest
```

### 9. Update a running host

Build and tag a new image, then replace the running container:

```bash
docker build \
	--build-arg NEXT_PUBLIC_SITE_URL="https://your-domain.example.com" \
	-t babyseaoss/marsha:latest .

docker rm -f marsha

docker run --detach \
	--name marsha \
	--restart unless-stopped \
	--env-file /etc/marsha.env \
	-p 3000:3000 \
	babyseaoss/marsha:latest
```

If you publish to another registry, replace `babyseaoss/marsha:latest` with your registry image tag.

### 10. Verify and debug

```bash
docker ps --filter name=marsha
docker logs --tail=100 marsha
curl -fsS "$NEXT_PUBLIC_SITE_URL/api/health" >/dev/null
```

For API checks, send caller requests with `Authorization: Bearer APP_API_KEY`.

## Troubleshooting

| Symptom                         | Check                                                                                 |
| :------------------------------ | :------------------------------------------------------------------------------------ |
| Browser points to the wrong URL | Rebuild with the final HTTPS URL before building.                                     |
| Container starts then exits     | Check `docker logs marsha` for missing env values.                                    |
| Runs stay queued                | Confirm the external scheduler is calling `/api/cron/process-runs`.                   |
| Provider calls fail             | Confirm the provider mode and provider keys match the chain models being used.        |
| Local build is slow or huge     | Confirm `.dockerignore` excludes `.next`, `.env`, `.env.*`, logs, and `node_modules`. |

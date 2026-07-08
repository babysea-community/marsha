# Deploy Marsha on Alibaba Cloud ECS

Alibaba Cloud ECS is a good custom host when you want the app runtime close to PolarDB, OSS, DashScope, and Qwen. This guide runs the production Docker image on one ECS instance and schedules queued-run recovery from the same host.

## What this uses

- [`Dockerfile`](../../Dockerfile) or the published `babyseaoss/marsha:latest` image.
- Alibaba Cloud ECS for the Node.js runtime.
- Alibaba Cloud PolarDB for PostgreSQL as the recommended database.
- Optional Alibaba Cloud OSS for durable generated media storage.
- Host cron for queued-run recovery.

## Prerequisites

- An Alibaba Cloud account with ECS, PolarDB for PostgreSQL, OSS, and Model Studio access.
- A Docker-capable ECS image, such as Alibaba Cloud Linux 3 or Ubuntu 24.04.
- Security group ingress for `80`/`443` from the internet and `22` only from trusted IPs.
- A reachable PostgreSQL database, preferably PolarDB/PostgreSQL for production.
- The schema applied with `pnpm run db:migrate` against `DATABASE_URL`.
- BYOK provider credentials. The example below includes `DASHSCOPE_API_KEY` for Alibaba Cloud Model Studio; add the other provider keys required by the models you plan to run.
- A public domain selected before the first production image build, for example `https://marsha.example.com`.

### 1. Create the ECS instance

Create an ECS instance in the same region and VPC as your PolarDB cluster when possible. Attach a public IP or put the instance behind Server Load Balancer. Keep the instance small for demos, then scale CPU and memory after observing image/video run load.

### 2. Install Docker

On Alibaba Cloud Linux:

```bash
sudo yum update -y
sudo yum install -y docker
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

On Ubuntu:

```bash
sudo apt update
sudo apt install -y docker.io
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Log out and back in so the Docker group applies.

### 3. Create `/etc/marsha.env`

Runtime secrets must be provided when the container starts, not as Docker build args. Keep values in `/etc/marsha.env`, a host secret manager, or your orchestrator.

```dotenv
NEXT_PUBLIC_SITE_URL=https://marsha.example.com
OWNER_EMAIL=owner@example.com
OWNER_PASSWORD=YOUR_OWNER_PASSWORD
OWNER_SESSION_SECRET=YOUR_OWNER_SESSION_SECRET
APP_DATABASE=polardb
DATABASE_URL=postgresql://USER:PASSWORD@CLUSTER.cluster-xxxxxxxxxxxx.REGION.rds.aliyuncs.com:5432/postgres?sslmode=require
APP_API_KEY=YOUR_APP_API_KEY
APP_CRON_SECRET=YOUR_APP_CRON_SECRET
APP_CALLBACK_SECRET=YOUR_APP_CALLBACK_SECRET
APP_PROVIDER_MODE=byok
DASHSCOPE_API_KEY=YOUR_DASHSCOPE_API_KEY
BFL_API_KEY=
BFL_REGION=global
BFL_API_BASE_URL=https://api.bfl.ai/v1
ARK_API_KEY=
GEMINI_API_KEY=
OPENAI_API_KEY=
RUNWAYML_API_SECRET=
BABYSEA_API_KEY=
BABYSEA_REGION=us
BABYSEA_API_BASE_URL=https://api.us.babysea.ai
BABYSEA_WEBHOOK_SECRET=
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

Protect the file:

```bash
sudo chown root:root /etc/marsha.env
sudo chmod 600 /etc/marsha.env
```

Unused BYOK provider keys can stay blank as long as you do not select those providers' models. The BabySea and Sentry values can stay blank or placeholder values when you stay in BYOK mode and do not upload source maps. Keep `SENTRY_AUTH_TOKEN` in CI or your build environment only when you intentionally upload source maps; it is not needed by the running container.

Media storage is optional. Keep `APP_STORAGE_PROVIDER=none` to run without it. To use Alibaba Cloud OSS, set `APP_STORAGE_PROVIDER=alibaba-cloud-oss` and fill `ALIBABA_CLOUD_OSS_REGION`, `ALIBABA_CLOUD_OSS_ACCESS_KEY_ID`, `ALIBABA_CLOUD_OSS_ACCESS_KEY_SECRET`, and `ALIBABA_CLOUD_OSS_BUCKET_NAME`. `ALIBABA_CLOUD_OSS_ENDPOINT` and `ALIBABA_CLOUD_OSS_PUBLIC_BASE_URL` are optional.

### 4. Apply the schema

Run the migration once from a machine that has this starter checked out and can reach the database:

```bash
cp .env.example .env.local
# Fill APP_DATABASE=polardb and DATABASE_URL in .env.local, then:
pnpm run db:migrate
```

The migration is idempotent, so it is safe to run again after schema changes.

### 5. Run Marsha

For local evaluation on the instance, the published image is enough:

```bash
docker pull babyseaoss/marsha:latest

docker run --detach \
	--name marsha \
	--restart unless-stopped \
	--env-file /etc/marsha.env \
	-p 3000:3000 \
	babyseaoss/marsha:latest
```

For production, build your own image with the final public URL so the Next.js client bundle is baked for the right domain:

```bash
docker build \
	--build-arg NEXT_PUBLIC_SITE_URL="https://marsha.example.com" \
	--build-arg NEXT_PUBLIC_SENTRY_ENVIRONMENT="production" \
	-t marsha:production \
	.
```

Then run `marsha:production` instead of `babyseaoss/marsha:latest`.

Put HTTPS in front with Alibaba Cloud SLB, Nginx, Caddy, or another reverse proxy before sending real callback URLs, browser traffic, or bearer tokens through the deployment.

### 6. Schedule recovery

Marsha processes runs immediately after creation, but ECS deployments should still call the recovery endpoint periodically. Add a host cron entry:

```cron
*/5 * * * * . /etc/marsha.env && curl -fsS -H "Authorization: Bearer $APP_CRON_SECRET" "$NEXT_PUBLIC_SITE_URL/api/cron/process-runs?limit=5" >/dev/null
```

The endpoint is idempotent and only processes eligible pending runs.

### 7. Verify

```bash
docker ps --filter name=marsha
docker logs --tail=100 marsha
curl -fsS https://marsha.example.com/api/health >/dev/null
```

For API routes, send `Authorization: Bearer $APP_API_KEY`.

### 8. Update

```bash
docker pull babyseaoss/marsha:latest
docker rm -f marsha
docker run --detach --name marsha --restart unless-stopped --env-file /etc/marsha.env -p 3000:3000 babyseaoss/marsha:latest
```

If you use a custom production image, rebuild it with the same final `NEXT_PUBLIC_SITE_URL` build arg before restarting.

## Troubleshooting

| Symptom                     | Check                                                                                                                   |
| :-------------------------- | :---------------------------------------------------------------------------------------------------------------------- |
| Container starts then exits | Check `docker logs marsha` for missing env values.                                                                      |
| Runs stay queued            | Confirm the host cron entry is running and sends `Authorization: Bearer $APP_CRON_SECRET`.                              |
| Provider calls fail         | Confirm `APP_PROVIDER_MODE` matches the provider keys in `/etc/marsha.env`; for Qwen/DashScope use `DASHSCOPE_API_KEY`. |
| Database errors             | Confirm `APP_DATABASE=polardb`, `DATABASE_URL` includes `?sslmode=require`, and the ECS egress IP is whitelisted.       |
| Public URL is wrong         | Update `NEXT_PUBLIC_SITE_URL` and rebuild your own image with the final domain.                                         |

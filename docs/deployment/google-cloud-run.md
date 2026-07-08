# Deploy Marsha on Google Cloud Run

Google Cloud Run runs from the production Docker image and gives you managed HTTPS, autoscaling, Cloud Logging, Secret Manager integration, and Cloud Scheduler for recovery jobs.

## Prerequisites

- Google Cloud project with billing enabled.
- `gcloud` CLI installed and authenticated.
- APIs enabled for Cloud Run, Cloud Build, Artifact Registry, Secret Manager, and Cloud Scheduler.
- A reachable PostgreSQL database, preferably Aurora/RDS for production.
- The schema applied with `pnpm run db:migrate` against `DATABASE_URL`.
- BYOK provider credentials. Default deployments use `APP_PROVIDER_MODE=byok`, so create the provider secrets required by the models you plan to run. The direct deploy command below uses `GEMINI_API_KEY` for Google models; create placeholders for unused providers if you use that command unchanged.
- Optional BabySea credentials only if you switch `APP_PROVIDER_MODE` to `babysea`.
- A final Cloud Run URL or custom domain selected before the production build.

### 1. Configure Google Cloud

```bash
export PROJECT_ID="your-project-id"
export REGION="us-central1"
export SERVICE_NAME="marsha"
export IMAGE_URI="$REGION-docker.pkg.dev/$PROJECT_ID/marsha/marsha:latest"

gcloud config set project "$PROJECT_ID"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com
```

Create the Artifact Registry repository once:

```bash
gcloud artifacts repositories create marsha \
  --repository-format=docker \
  --location="$REGION" \
  --description="Container images"
```

### 2. Store runtime secrets

Create Secret Manager entries for the values and reads at runtime.

```bash
printf '%s' 'owner@example.com' | gcloud secrets create marsha-owner-email --data-file=-
printf '%s' 'YOUR_OWNER_PASSWORD' | gcloud secrets create marsha-owner-password --data-file=-
printf '%s' 'YOUR_OWNER_SESSION_SECRET' | gcloud secrets create marsha-owner-session-secret --data-file=-
printf '%s' 'postgresql://USER:PASSWORD@HOST:5432/postgres?sslmode=require' | gcloud secrets create marsha-database-url --data-file=-
printf '%s' 'YOUR_APP_API_KEY' | gcloud secrets create marsha-api-key --data-file=-
printf '%s' 'YOUR_APP_CRON_SECRET' | gcloud secrets create marsha-cron-secret --data-file=-
printf '%s' 'YOUR_APP_CALLBACK_SECRET' | gcloud secrets create marsha-callback-secret --data-file=-
printf '%s' 'YOUR_DASHSCOPE_API_KEY' | gcloud secrets create marsha-dashscope-api-key --data-file=-
printf '%s' 'YOUR_BFL_API_KEY' | gcloud secrets create marsha-bfl-api-key --data-file=-
printf '%s' 'YOUR_ARK_API_KEY' | gcloud secrets create marsha-ark-api-key --data-file=-
printf '%s' 'YOUR_GEMINI_API_KEY' | gcloud secrets create marsha-gemini-api-key --data-file=-
printf '%s' 'YOUR_OPENAI_API_KEY' | gcloud secrets create marsha-openai-api-key --data-file=-
printf '%s' 'YOUR_RUNWAY_API_KEY' | gcloud secrets create marsha-runway-api-secret --data-file=-
printf '%s' 'YOUR_BABYSEA_API_KEY_OR_PLACEHOLDER' | gcloud secrets create marsha-babysea-api-key --data-file=-
printf '%s' 'YOUR_BABYSEA_WEBHOOK_SECRET_OR_PLACEHOLDER' | gcloud secrets create marsha-babysea-webhook-secret --data-file=-
```

For BabySea mode, replace `YOUR_BABYSEA_API_KEY_OR_PLACEHOLDER` with a real BabySea API key.

If you are using direct `gcloud run deploy` flags instead of the YAML, you can omit the BabySea secrets while staying in BYOK mode.

Media storage and the Agentic Workflow planner are optional. To enable them, create the matching secrets and append them to the deploy command:

```bash
printf '%s' 'YOUR_AGENT_CHAIN_AWS_BEDROCK_TOKEN' | gcloud secrets create marsha-bedrock-bearer-token --data-file=-
printf '%s' 'YOUR_ALIBABA_CLOUD_OSS_ACCESS_KEY_ID' | gcloud secrets create marsha-oss-access-key-id --data-file=-
printf '%s' 'YOUR_ALIBABA_CLOUD_OSS_ACCESS_KEY_SECRET' | gcloud secrets create marsha-oss-access-key-secret --data-file=-
printf '%s' 'YOUR_AWS_S3_ACCESS_KEY_ID' | gcloud secrets create marsha-s3-access-key-id --data-file=-
printf '%s' 'YOUR_AWS_S3_SECRET_ACCESS_KEY' | gcloud secrets create marsha-s3-secret-access-key --data-file=-
printf '%s' 'YOUR_HUGGINGFACE_STORAGE_ACCESS_KEY_ID' | gcloud secrets create marsha-hf-storage-access-key-id --data-file=-
printf '%s' 'YOUR_HUGGINGFACE_STORAGE_SECRET_ACCESS_KEY' | gcloud secrets create marsha-hf-storage-secret-access-key --data-file=-
printf '%s' 'YOUR_MINIO_ACCESS_KEY_ID' | gcloud secrets create marsha-minio-access-key-id --data-file=-
printf '%s' 'YOUR_MINIO_SECRET_ACCESS_KEY' | gcloud secrets create marsha-minio-secret-access-key --data-file=-
printf '%s' 'YOUR_SCALEWAY_OBJECT_STORAGE_ACCESS_KEY_ID' | gcloud secrets create marsha-scaleway-access-key-id --data-file=-
printf '%s' 'YOUR_SCALEWAY_OBJECT_STORAGE_SECRET_ACCESS_KEY' | gcloud secrets create marsha-scaleway-secret-access-key --data-file=-
printf '%s' 'YOUR_SPACES_ACCESS_KEY_ID' | gcloud secrets create marsha-spaces-access-key-id --data-file=-
printf '%s' 'YOUR_SPACES_SECRET_ACCESS_KEY' | gcloud secrets create marsha-spaces-secret-access-key --data-file=-
printf '%s' 'YOUR_BLOB_READ_WRITE_TOKEN' | gcloud secrets create marsha-blob-token --data-file=-
```

Then append the non-secret storage settings to `--set-env-vars` (set `APP_STORAGE_PROVIDER=alibaba-cloud-oss`, `aws-s3`, `backblaze-b2`, `cloudflare-r2`, `huggingface-storage-buckets`, `minio`, `scaleway-object-storage`, `spaces-object-storage`, or `vercel-blob`; include the matching bucket names, endpoint URLs, public base URLs, account IDs, regions, and Hugging Face namespaces) and the secrets to `--set-secrets` (`AGENT_CHAIN_AWS_BEDROCK_TOKEN=marsha-bedrock-bearer-token:latest`, `ALIBABA_CLOUD_OSS_ACCESS_KEY_ID=marsha-oss-access-key-id:latest`, `ALIBABA_CLOUD_OSS_ACCESS_KEY_SECRET=marsha-oss-access-key-secret:latest`, `AWS_S3_ACCESS_KEY_ID=marsha-s3-access-key-id:latest`, `AWS_S3_SECRET_ACCESS_KEY=marsha-s3-secret-access-key:latest`, `BACKBLAZE_B2_KEY_ID=marsha-b2-key-id:latest`, `BACKBLAZE_B2_APPLICATION_KEY=marsha-b2-application-key:latest`, `CLOUDFLARE_R2_ACCESS_KEY_ID=marsha-r2-access-key-id:latest`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY=marsha-r2-secret-access-key:latest`, `HUGGINGFACE_STORAGE_ACCESS_KEY_ID=marsha-hf-storage-access-key-id:latest`, `HUGGINGFACE_STORAGE_SECRET_ACCESS_KEY=marsha-hf-storage-secret-access-key:latest`, `MINIO_ACCESS_KEY_ID=marsha-minio-access-key-id:latest`, `MINIO_SECRET_ACCESS_KEY=marsha-minio-secret-access-key:latest`, `SCALEWAY_OBJECT_STORAGE_ACCESS_KEY_ID=marsha-scaleway-access-key-id:latest`, `SCALEWAY_OBJECT_STORAGE_SECRET_ACCESS_KEY=marsha-scaleway-secret-access-key:latest`, `SPACES_ACCESS_KEY_ID=marsha-spaces-access-key-id:latest`, `SPACES_SECRET_ACCESS_KEY=marsha-spaces-secret-access-key:latest`, `BLOB_READ_WRITE_TOKEN=marsha-blob-token:latest`). The checked-in `.gcp/cloud-run-service.yaml` includes the non-secret defaults; add the matching secret references there only when you enable Agentic Workflow or storage from the YAML.

### 3. Build and push the image

Next.js bakes public values into the build. Use the final public URL as a Docker build arg.

```bash
export SITE_URL="https://marsha-REGION-PROJECT_HASH.a.run.app"

gcloud auth configure-docker "$REGION-docker.pkg.dev"

docker build \
  --build-arg NEXT_PUBLIC_SITE_URL="$SITE_URL" \
  --build-arg NEXT_PUBLIC_SENTRY_ENVIRONMENT="production" \
  -t "$IMAGE_URI" \
  .

docker push "$IMAGE_URI"
```

Cloud Build can run the same Dockerfile if you prefer remote builds. If you use Cloud Build with custom substitutions, mirror the same build args in your Cloud Build config.

### 4. Deploy to Cloud Run

Deploy with direct flags:

```bash
gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE_URI" \
  --region "$REGION" \
  --port 3000 \
  --allow-unauthenticated \
  --min-instances 1 \
  --max-instances 10 \
  --set-env-vars "PORT=3000,HOSTNAME=0.0.0.0,NEXT_TELEMETRY_DISABLED=1,NEXT_PUBLIC_SITE_URL=$SITE_URL,APP_DATABASE=aurora,APP_PROVIDER_MODE=byok,BFL_REGION=global,BFL_API_BASE_URL=https://api.bfl.ai/v1,BABYSEA_REGION=us,BABYSEA_API_BASE_URL=https://api.us.babysea.ai,AGENT_CHAIN_AWS_BEDROCK_REGION=us-east-1,AGENT_CHAIN_AWS_BEDROCK_AGENT=us.amazon.nova-2-lite-v1:0,APP_STORAGE_PROVIDER=none,NEXT_PUBLIC_SENTRY_ENVIRONMENT=production" \
  --set-secrets "OWNER_EMAIL=marsha-owner-email:latest,OWNER_PASSWORD=marsha-owner-password:latest,OWNER_SESSION_SECRET=marsha-owner-session-secret:latest,DATABASE_URL=marsha-database-url:latest,APP_API_KEY=marsha-api-key:latest,APP_CRON_SECRET=marsha-cron-secret:latest,APP_CALLBACK_SECRET=marsha-callback-secret:latest,DASHSCOPE_API_KEY=marsha-dashscope-api-key:latest,BFL_API_KEY=marsha-bfl-api-key:latest,ARK_API_KEY=marsha-ark-api-key:latest,GEMINI_API_KEY=marsha-gemini-api-key:latest,OPENAI_API_KEY=marsha-openai-api-key:latest,RUNWAYML_API_SECRET=marsha-runway-api-secret:latest"
```

Or update placeholders in `.gcp/cloud-run-service.yaml` and apply it:

```bash
gcloud run services replace .gcp/cloud-run-service.yaml --region "$REGION"
```

For a custom domain, map the domain, update `SITE_URL`, rebuild, push, and redeploy so the public URL is baked into the Next.js build.

### 5. Add Cloud Scheduler recovery

It processes runs immediately after creation, but Cloud Run deployments should still call the recovery endpoint periodically.

```bash
export CRON_SECRET="YOUR_APP_CRON_SECRET"

gcloud scheduler jobs create http marsha-process-runs \
  --location="$REGION" \
  --schedule="*/5 * * * *" \
  --uri="$SITE_URL/api/cron/process-runs?limit=5" \
  --http-method=GET \
  --headers="Authorization=Bearer $CRON_SECRET"
```

Use `*/1 * * * *` for high-volume deployments. The endpoint is idempotent and only processes eligible pending runs.

### 6. Verify the deployment

```bash
gcloud run services describe "$SERVICE_NAME" --region "$REGION"
curl -fsS "$SITE_URL/"
curl -fsS \
  -H "Authorization: Bearer YOUR_APP_API_KEY" \
  "$SITE_URL/api/health"
```

Run the starter doctor before shipping changes:

```bash
pnpm run doctor
```

## Troubleshooting

- If public URLs are wrong, rebuild with the correct `NEXT_PUBLIC_SITE_URL` and redeploy.
- If deployment fails with missing secrets, either create the Secret Manager entries referenced by `.gcp/cloud-run-service.yaml` or remove unused optional provider entries.
- If run recovery stalls, confirm the Cloud Scheduler job sends `Authorization: Bearer YOUR_APP_CRON_SECRET`.
- If provider calls fail, confirm `APP_PROVIDER_MODE` matches the secrets attached to the Cloud Run service.

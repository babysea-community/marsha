# Deploy Marsha with AWS CloudFormation

CloudFormation is the managed AWS deployment path. The template creates the AWS infrastructure; you still need to choose networking, create the stack, fill retained secrets, build and push the Docker image, then start the ECS service.

Use this guide when you want managed AWS infrastructure with ECS Fargate, an Application Load Balancer, ECR, Secrets Manager, CloudWatch Logs, and optional EventBridge queued-run recovery.

## What this deploys

[`.aws/cloudformation.yml`](../../.aws/cloudformation.yml), [`Dockerfile`](../../Dockerfile), and [`.dockerignore`](../../.dockerignore) work together to deploy on AWS.

| Resource                                  | Purpose                                                                        |
| :---------------------------------------- | :----------------------------------------------------------------------------- |
| ECR repository                            | Stores the image you build locally or in CI.                                   |
| ECS cluster, task definition, and service | Runs the Next.js API engine on Fargate.                                        |
| Application Load Balancer                 | Exposes HTTP traffic to the ECS service.                                       |
| Secrets Manager secrets                   | Holds runtime secrets and provider keys. Secrets are retained on stack delete. |
| CloudWatch Logs                           | Stores web and cron task logs.                                                 |
| EventBridge rule                          | Optional queued-run recovery that calls `/api/cron/process-runs`.              |

## Prerequisites

- AWS CLI v2 installed and authenticated for the target account.
- Docker running locally.
- Permission to create CloudFormation, ECR, ECS, EC2 security group, IAM role, ELBv2, Events, Logs, and Secrets Manager resources.
- A VPC with two or more subnets.
- Outbound internet from ECS tasks so it can reach Aurora/PostgreSQL, BabySea, and inference providers.
- A reachable PostgreSQL database, preferably Aurora/RDS for production.
- The schema applied with `pnpm run db:migrate` against `DATABASE_URL`.
- Runtime values from [`.env.example`](../../.env.example).

For a first deployment, use public subnets with `AssignPublicIp=ENABLED`. For production, private subnets with NAT are usually better.

The template exposes an HTTP load balancer. Before sending production bearer tokens or real workloads, put HTTPS in front with ACM, Route 53, or CloudFront. If you already know the final HTTPS URL, use that value for `SiteUrl` before building the image.

### 1. Set local variables

```bash
export AWS_REGION=us-east-1
export STACK_NAME=marsha
export PROJECT_NAME=marsha
export VPC_ID=vpc-1234567890abcdef0
export SUBNET_IDS=subnet-11111111111111111,subnet-22222222222222222
export DATABASE_URL='postgresql://USER:PASSWORD@CLUSTER.cluster-xxxxxxxxxxxx.us-east-1.rds.amazonaws.com:5432/postgres?sslmode=require'
```

Keep these values in one shell while you create the stack, build the image, and update the stack.

### 2. Create the stopped stack

Create the stack with `DesiredCount=0` and `EnableCron=DISABLED`. This lets AWS create the ECR repository and retained Secrets Manager names before any ECS task starts.

```bash
aws cloudformation deploy \
	--region "$AWS_REGION" \
	--template-file .aws/cloudformation.yml \
	--stack-name "$STACK_NAME" \
	--capabilities CAPABILITY_IAM \
	--parameter-overrides \
		ProjectName="$PROJECT_NAME" \
		VpcId="$VPC_ID" \
		SubnetIds="$SUBNET_IDS" \
		DesiredCount=0 \
		EnableCron=DISABLED
```

Read the outputs you need for the next steps:

```bash
SITE_URL=$(aws cloudformation describe-stacks \
	--region "$AWS_REGION" \
	--stack-name "$STACK_NAME" \
	--query "Stacks[0].Outputs[?OutputKey=='SiteUrl'].OutputValue" \
	--output text)

REPOSITORY_URI=$(aws cloudformation describe-stacks \
	--region "$AWS_REGION" \
	--stack-name "$STACK_NAME" \
	--query "Stacks[0].Outputs[?OutputKey=='EcrRepositoryUri'].OutputValue" \
	--output text)

SECRET_PREFIX=$(aws cloudformation describe-stacks \
	--region "$AWS_REGION" \
	--stack-name "$STACK_NAME" \
	--query "Stacks[0].Outputs[?OutputKey=='SecretPrefix'].OutputValue" \
	--output text)

printf 'Site URL: %s\nECR: %s\nSecret prefix: %s\n' \
	"$SITE_URL" "$REPOSITORY_URI" "$SECRET_PREFIX"
```

If you are deploying behind a custom HTTPS domain, set `SITE_URL=https://your-domain.example.com` before building and pass `SiteUrl="$SITE_URL"` when you update the stack.

### 3. Populate runtime secrets

Required runtime secrets for every real deployment are:

- `OWNER_EMAIL`
- `OWNER_PASSWORD`
- `OWNER_SESSION_SECRET`
- `DATABASE_URL`
- `APP_API_KEY`
- `APP_CRON_SECRET`
- `APP_CALLBACK_SECRET`

With the default `ProviderMode=byok`, populate the BYOK inference keys required by the models you plan to run. The template uses these BYOK key names: `DASHSCOPE_API_KEY`, `BFL_API_KEY`, `ARK_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, and `RUNWAYML_API_SECRET`.

With `ProviderMode=babysea`, put `BABYSEA_API_KEY` in Secrets Manager and optionally put `BABYSEA_WEBHOOK_SECRET` there too. The CloudFormation stack maps the `BabySeaRegion` and `BabySeaApiBaseUrl` parameters to the runtime `BABYSEA_REGION` and `BABYSEA_API_BASE_URL` environment variables.

Media storage and the Agentic Workflow planner are optional. Set `StorageProvider` to `alibaba-cloud-oss`, `aws-s3`, `backblaze-b2`, `cloudflare-r2`, `huggingface-storage-buckets`, `minio`, `scaleway-object-storage`, `spaces-object-storage`, or `vercel-blob` to enable storage. For Alibaba Cloud OSS, configure `ALIBABA_CLOUD_OSS_REGION`, `ALIBABA_CLOUD_OSS_ACCESS_KEY_ID`, `ALIBABA_CLOUD_OSS_ACCESS_KEY_SECRET`, `ALIBABA_CLOUD_OSS_BUCKET_NAME`, `ALIBABA_CLOUD_OSS_ENDPOINT`, and `ALIBABA_CLOUD_OSS_PUBLIC_BASE_URL`. For AWS S3, configure `AWS_S3_REGION`, `AWS_S3_ACCESS_KEY_ID`, `AWS_S3_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET_NAME`, and `AWS_S3_ENDPOINT_URL`. For Backblaze B2, configure `BACKBLAZE_B2_KEY_ID`, `BACKBLAZE_B2_APPLICATION_KEY`, `BACKBLAZE_B2_BUCKET_NAME`, `BACKBLAZE_B2_BUCKET_ID`, and `BACKBLAZE_B2_PUBLIC_BASE_URL`. For Cloudflare R2, configure `CLOUDFLARE_R2_ACCOUNT_ID`, `CLOUDFLARE_R2_ACCESS_KEY_ID`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_R2_BUCKET_NAME`, `CLOUDFLARE_R2_ENDPOINT_URL`, and `CLOUDFLARE_R2_CUSTOM_DOMAIN_URL`. For Hugging Face Storage Buckets, configure `HUGGINGFACE_STORAGE_NAMESPACE`, `HUGGINGFACE_STORAGE_ACCESS_KEY_ID`, `HUGGINGFACE_STORAGE_SECRET_ACCESS_KEY`, `HUGGINGFACE_STORAGE_BUCKET_NAME`, and `HUGGINGFACE_STORAGE_PUBLIC_BASE_URL`. For MinIO, configure `MINIO_ENDPOINT_URL`, `MINIO_ACCESS_KEY_ID`, `MINIO_SECRET_ACCESS_KEY`, `MINIO_BUCKET_NAME`, `MINIO_REGION`, and `MINIO_PUBLIC_BASE_URL`. For Scaleway Object Storage, configure `SCALEWAY_OBJECT_STORAGE_REGION`, `SCALEWAY_OBJECT_STORAGE_ACCESS_KEY_ID`, `SCALEWAY_OBJECT_STORAGE_SECRET_ACCESS_KEY`, `SCALEWAY_OBJECT_STORAGE_BUCKET_NAME`, `SCALEWAY_OBJECT_STORAGE_ENDPOINT_URL`, and `SCALEWAY_OBJECT_STORAGE_PUBLIC_BASE_URL`. For Spaces Object Storage, configure `SPACES_REGION`, `SPACES_ACCESS_KEY_ID`, `SPACES_SECRET_ACCESS_KEY`, `SPACES_BUCKET_NAME`, `SPACES_ENDPOINT_URL`, and `SPACES_PUBLIC_BASE_URL`. For Vercel Blob, configure `BLOB_READ_WRITE_TOKEN`. Populate `AGENT_CHAIN_AWS_BEDROCK_TOKEN` with the `BedrockRegion` and `BedrockNovaAgentModel` parameters to enable the Amazon Nova planner. Placeholder values are acceptable only when you will not use the related feature; replace `AGENT_CHAIN_AWS_BEDROCK_TOKEN` with a real token before running Copilot or Autopilot.

```bash
put_secret() {
	aws secretsmanager put-secret-value \
		--region "$AWS_REGION" \
		--secret-id "${SECRET_PREFIX}$1" \
		--secret-string "$2"
}

put_secret OWNER_EMAIL owner@example.com
put_secret OWNER_PASSWORD replace-with-strong-owner-password
put_secret OWNER_SESSION_SECRET "$(openssl rand -hex 32)"
put_secret DATABASE_URL "$DATABASE_URL"
put_secret APP_API_KEY "$(openssl rand -hex 32)"
put_secret APP_CRON_SECRET "$(openssl rand -hex 32)"
put_secret APP_CALLBACK_SECRET "$(openssl rand -hex 32)"
put_secret DASHSCOPE_API_KEY replace-with-dashscope-api-key
put_secret BFL_API_KEY replace-with-bfl-api-key
put_secret ARK_API_KEY replace-with-ark-api-key
put_secret GEMINI_API_KEY replace-with-gemini-api-key
put_secret OPENAI_API_KEY replace-with-openai-api-key
put_secret RUNWAYML_API_SECRET replace-with-runway-api-key
put_secret BABYSEA_API_KEY replace-with-babysea-api-key
put_secret BABYSEA_WEBHOOK_SECRET replace-with-babysea-webhook-secret
put_secret AGENT_CHAIN_AWS_BEDROCK_TOKEN replace-with-real-bedrock-bearer-token-or-placeholder-if-unused
put_secret ALIBABA_CLOUD_OSS_ACCESS_KEY_ID replace-with-oss-access-key-or-placeholder
put_secret ALIBABA_CLOUD_OSS_ACCESS_KEY_SECRET replace-with-oss-secret-or-placeholder
put_secret AWS_S3_ACCESS_KEY_ID replace-with-s3-access-key-or-placeholder
put_secret AWS_S3_SECRET_ACCESS_KEY replace-with-s3-secret-access-key-or-placeholder
put_secret BACKBLAZE_B2_KEY_ID replace-with-b2-key-id-or-placeholder
put_secret BACKBLAZE_B2_APPLICATION_KEY replace-with-b2-application-key-or-placeholder
put_secret CLOUDFLARE_R2_ACCESS_KEY_ID replace-with-r2-access-key-or-placeholder
put_secret CLOUDFLARE_R2_SECRET_ACCESS_KEY replace-with-r2-secret-access-key-or-placeholder
put_secret HUGGINGFACE_STORAGE_ACCESS_KEY_ID replace-with-hf-s3-access-key-or-placeholder
put_secret HUGGINGFACE_STORAGE_SECRET_ACCESS_KEY replace-with-hf-s3-secret-key-or-placeholder
put_secret MINIO_ACCESS_KEY_ID replace-with-minio-access-key-or-placeholder
put_secret MINIO_SECRET_ACCESS_KEY replace-with-minio-secret-or-placeholder
put_secret SCALEWAY_OBJECT_STORAGE_ACCESS_KEY_ID replace-with-scaleway-access-key-or-placeholder
put_secret SCALEWAY_OBJECT_STORAGE_SECRET_ACCESS_KEY replace-with-scaleway-secret-or-placeholder
put_secret SPACES_ACCESS_KEY_ID replace-with-spaces-access-key-or-placeholder
put_secret SPACES_SECRET_ACCESS_KEY replace-with-spaces-secret-or-placeholder
put_secret BLOB_READ_WRITE_TOKEN replace-with-vercel-blob-token-or-placeholder
put_secret SENTRY_ORG replace-with-sentry-org
put_secret SENTRY_PROJECT replace-with-sentry-project
```

Unused BYOK provider secrets can be placeholders as long as you do not select those providers' models. The Sentry values can be placeholders when you do not upload source maps. Keep `SENTRY_AUTH_TOKEN` in CI or your build environment only when you intentionally upload source maps; it is not needed by the running ECS container. For BabySea mode, replace the BabySea placeholders with real values and set `ProviderMode=babysea` on the stack update.

Do not put `DATABASE_URL`, owner credentials, provider keys, or the secrets in build args. They belong in Secrets Manager and are injected at runtime.

### 4. Build and push the image

Next.js reads `NEXT_PUBLIC_*` values at build time. Build with the final public values, push the image to ECR, then use that image URI in the stack update.

```bash
aws ecr get-login-password --region "$AWS_REGION" | \
	docker login --username AWS --password-stdin "${REPOSITORY_URI%/*}"

docker build \
	--build-arg NEXT_PUBLIC_SITE_URL="$SITE_URL" \
	-t marsha:aws .

docker tag marsha:aws "$REPOSITORY_URI:latest"
docker push "$REPOSITORY_URI:latest"
```

If you use Sentry client telemetry, also pass `NEXT_PUBLIC_SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_ENVIRONMENT` as build args.

### 5. Start the ECS service

Update the stack with the image, the same network values, and `DesiredCount=1`. Enable EventBridge queued-run recovery when `APP_CRON_SECRET` is already populated.

```bash
aws cloudformation deploy \
	--region "$AWS_REGION" \
	--template-file .aws/cloudformation.yml \
	--stack-name "$STACK_NAME" \
	--capabilities CAPABILITY_IAM \
	--parameter-overrides \
		ProjectName="$PROJECT_NAME" \
		VpcId="$VPC_ID" \
		SubnetIds="$SUBNET_IDS" \
		ImageUri="$REPOSITORY_URI:latest" \
		SiteUrl="$SITE_URL" \
		DesiredCount=1 \
		EnableCron=ENABLED
```

Open `$SITE_URL` after the ECS service reaches steady state.

For BabySea mode, include these parameter overrides in the same stack update:

```bash
ProviderMode=babysea \
BabySeaApiBaseUrl=https://api.us.babysea.ai \
BabySeaRegion=us
```

### 6. Verify the deployment

```bash
CLUSTER_NAME=$(aws cloudformation describe-stacks \
	--region "$AWS_REGION" \
	--stack-name "$STACK_NAME" \
	--query "Stacks[0].Outputs[?OutputKey=='ClusterName'].OutputValue" \
	--output text)

SERVICE_NAME=$(aws cloudformation describe-stacks \
	--region "$AWS_REGION" \
	--stack-name "$STACK_NAME" \
	--query "Stacks[0].Outputs[?OutputKey=='ServiceName'].OutputValue" \
	--output text)

LOG_GROUP_NAME=$(aws cloudformation describe-stacks \
	--region "$AWS_REGION" \
	--stack-name "$STACK_NAME" \
	--query "Stacks[0].Outputs[?OutputKey=='LogGroupName'].OutputValue" \
	--output text)

aws ecs describe-services \
	--region "$AWS_REGION" \
	--cluster "$CLUSTER_NAME" \
	--services "$SERVICE_NAME" \
	--query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount,Events:events[0:3].message}'

curl -fsS "${SITE_URL%/}/api/health" >/dev/null

aws logs tail "$LOG_GROUP_NAME" \
	--region "$AWS_REGION" \
	--since 30m
```

For API checks, send caller requests with `Authorization: Bearer APP_API_KEY`.

### 7. Update the app

Build a new image tag, push it, then update `ImageUri`.

```bash
IMAGE_TAG=$(git rev-parse --short HEAD)

docker build \
	--build-arg NEXT_PUBLIC_SITE_URL="$SITE_URL" \
	-t "marsha:$IMAGE_TAG" .

docker tag "marsha:$IMAGE_TAG" "$REPOSITORY_URI:$IMAGE_TAG"
docker push "$REPOSITORY_URI:$IMAGE_TAG"

aws cloudformation deploy \
	--region "$AWS_REGION" \
	--template-file .aws/cloudformation.yml \
	--stack-name "$STACK_NAME" \
	--capabilities CAPABILITY_IAM \
	--parameter-overrides \
		ProjectName="$PROJECT_NAME" \
		VpcId="$VPC_ID" \
		SubnetIds="$SUBNET_IDS" \
		ImageUri="$REPOSITORY_URI:$IMAGE_TAG" \
		SiteUrl="$SITE_URL" \
		DesiredCount=1 \
		EnableCron=ENABLED
```

### 8. Clean up

Set `DesiredCount=0` before deleting if you want a quieter shutdown, then delete the stack:

```bash
aws cloudformation deploy \
	--region "$AWS_REGION" \
	--template-file .aws/cloudformation.yml \
	--stack-name "$STACK_NAME" \
	--capabilities CAPABILITY_IAM \
	--parameter-overrides \
		ProjectName="$PROJECT_NAME" \
		VpcId="$VPC_ID" \
		SubnetIds="$SUBNET_IDS" \
		DesiredCount=0 \
		EnableCron=DISABLED

aws cloudformation delete-stack \
	--region "$AWS_REGION" \
	--stack-name "$STACK_NAME"
```

The ECR repository and Secrets Manager secrets use retain policies. Delete retained images and secrets manually when you are sure you no longer need them.

## Troubleshooting

| Symptom                    | Check                                                                                                           |
| :------------------------- | :-------------------------------------------------------------------------------------------------------------- |
| ECS task never starts      | Confirm `ImageUri` is not the placeholder image and the image exists in ECR.                                    |
| Task stops immediately     | Tail CloudWatch logs and confirm required Secrets Manager values are populated.                                 |
| Load balancer returns 503  | Confirm the ECS service has a running task and the target group health check path returns 200-399.              |
| App cannot reach providers | Confirm task subnets have outbound internet through public IP or NAT.                                           |
| Cron does not run          | Confirm `EnableCron=ENABLED`, `APP_CRON_SECRET` is populated, and the EventBridge target can run the cron task. |
| Public URL is wrong        | Rebuild with the final `NEXT_PUBLIC_SITE_URL`, push the image, and update `SiteUrl`.                            |

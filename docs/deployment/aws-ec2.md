# Run Marsha on EC2

EC2 gives you one inspectable VM. You run the VM yourself, so you must create a stable public URL, build and push a Docker image, store runtime values in Parameter Store, create an instance profile, launch Amazon Linux 2023 with user data, and operate updates and cleanup.

Use this guide when you want one inspectable VM. Use CloudFormation when you want managed ECS/Fargate infrastructure.

## What this uses

- [`.aws/ec2-user-data.sh`](../../.aws/ec2-user-data.sh) bootstraps Amazon Linux 2023.
- [`Dockerfile`](../../Dockerfile) builds the image.
- [`.dockerignore`](../../.dockerignore) keeps secrets and build output out of the image context.
- Amazon ECR stores the image.
- AWS Systems Manager Parameter Store stores runtime values.
- A systemd timer calls `/api/cron/process-runs` every five minutes.

The direct `http://$ELASTIC_IP` flow below is for first launch and evaluation only. Before sending production bearer tokens or real workloads, put HTTPS in front with an ALB plus ACM, CloudFront plus ACM, or a reverse proxy on a domain. Then rebuild with `SITE_URL=https://your-domain.example.com`.

## Prerequisites

- AWS CLI v2 installed and authenticated for the target account.
- Docker running locally.
- Permission to create EC2, ECR, IAM, SSM Parameter Store, security group, key pair, and Elastic IP resources.
- A VPC and subnet that can reach the internet.
- A reachable PostgreSQL database, preferably Aurora/RDS for production.
- The schema applied with `pnpm run db:migrate` against `DATABASE_URL`.
- Runtime values from [`.env.example`](../../.env.example).

### 1. Set local variables

```bash
export AWS_REGION=us-east-1
export VPC_ID=vpc-1234567890abcdef0
export SUBNET_ID=subnet-11111111111111111
export KEY_NAME=marsha
export PARAMETER_PREFIX=/marsha/ec2
export DATABASE_URL='postgresql://USER:PASSWORD@CLUSTER.cluster-xxxxxxxxxxxx.us-east-1.rds.amazonaws.com:5432/postgres?sslmode=require'
```

Keep these values in one shell while you create the image, secrets, IAM profile, and instance.

### 2. Allocate a stable public URL

Allocate an Elastic IP before the image build so `NEXT_PUBLIC_SITE_URL` is stable.

```bash
ALLOCATION_ID=$(aws ec2 allocate-address \
	--region "$AWS_REGION" \
	--domain vpc \
	--query AllocationId \
	--output text)

ELASTIC_IP=$(aws ec2 describe-addresses \
	--region "$AWS_REGION" \
	--allocation-ids "$ALLOCATION_ID" \
	--query 'Addresses[0].PublicIp' \
	--output text)

SITE_URL=http://$ELASTIC_IP
```

For production HTTPS, set `SITE_URL=https://your-domain.example.com` instead and point the domain to the instance or proxy after launch.

### 3. Build and push the image to ECR

```bash
aws ecr describe-repositories \
	--region "$AWS_REGION" \
	--repository-names marsha >/dev/null 2>&1 || \
	aws ecr create-repository \
		--region "$AWS_REGION" \
		--repository-name marsha \
		--image-scanning-configuration scanOnPush=true >/dev/null

REPOSITORY_URI=$(aws ecr describe-repositories \
	--region "$AWS_REGION" \
	--repository-names marsha \
	--query 'repositories[0].repositoryUri' \
	--output text)

aws ecr get-login-password --region "$AWS_REGION" | \
	docker login --username AWS --password-stdin "${REPOSITORY_URI%/*}"

docker build \
	--build-arg NEXT_PUBLIC_SITE_URL="$SITE_URL" \
	-t marsha:ec2 .

docker tag marsha:ec2 "$REPOSITORY_URI:latest"
docker push "$REPOSITORY_URI:latest"
```

If you use Sentry client telemetry, also pass `NEXT_PUBLIC_SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_ENVIRONMENT` as build args.

### 4. Store runtime values in parameter store

The user-data script reads decrypted parameters from AWS Systems Manager Parameter Store and writes a root-only env file on the instance. Values must be single-line strings. Use comma-separated API keys if you need multiple caller keys.

Required parameters for every real deployment are:

- `OWNER_EMAIL`
- `OWNER_PASSWORD`
- `OWNER_SESSION_SECRET`
- `DATABASE_URL`
- `APP_API_KEY`
- `APP_CRON_SECRET`
- `APP_CALLBACK_SECRET`

With the default `APP_PROVIDER_MODE=byok`, populate the BYOK inference keys required by the models you plan to run. The commands below use these BYOK key names: `DASHSCOPE_API_KEY`, `BFL_API_KEY`, `ARK_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, and `RUNWAYML_API_SECRET`.

With `APP_PROVIDER_MODE=babysea`, set `BABYSEA_API_KEY`, `BABYSEA_REGION`, and `BABYSEA_API_BASE_URL`. Add `BABYSEA_WEBHOOK_SECRET` if your integration uses it.

```bash
put_parameter() {
	aws ssm put-parameter \
		--region "$AWS_REGION" \
		--name "$PARAMETER_PREFIX/$1" \
		--type SecureString \
		--overwrite \
		--value "$2"
}

put_parameter OWNER_EMAIL owner@example.com
put_parameter OWNER_PASSWORD replace-with-strong-owner-password
put_parameter OWNER_SESSION_SECRET "$(openssl rand -hex 32)"
put_parameter APP_DATABASE aurora
put_parameter DATABASE_URL "$DATABASE_URL"
put_parameter APP_API_KEY "$(openssl rand -hex 32)"
put_parameter APP_CRON_SECRET "$(openssl rand -hex 32)"
put_parameter APP_CALLBACK_SECRET "$(openssl rand -hex 32)"
put_parameter APP_PROVIDER_MODE byok
put_parameter DASHSCOPE_API_KEY replace-with-dashscope-api-key
put_parameter BFL_API_KEY replace-with-bfl-api-key
put_parameter BFL_REGION global
put_parameter BFL_API_BASE_URL https://api.bfl.ai/v1
put_parameter ARK_API_KEY replace-with-ark-api-key
put_parameter GEMINI_API_KEY replace-with-gemini-api-key
put_parameter OPENAI_API_KEY replace-with-openai-api-key
put_parameter RUNWAYML_API_SECRET replace-with-runway-api-key
put_parameter BABYSEA_API_KEY replace-with-babysea-api-key-or-placeholder
put_parameter BABYSEA_REGION us
put_parameter BABYSEA_API_BASE_URL https://api.us.babysea.ai
put_parameter BABYSEA_WEBHOOK_SECRET replace-with-babysea-webhook-secret-or-placeholder
put_parameter AGENT_CHAIN_AWS_BEDROCK_REGION us-east-1
put_parameter AGENT_CHAIN_AWS_BEDROCK_AGENT us.amazon.nova-2-lite-v1:0
put_parameter APP_STORAGE_PROVIDER none
put_parameter ALIBABA_CLOUD_OSS_REGION replace-with-oss-region-or-skip
put_parameter ALIBABA_CLOUD_OSS_ACCESS_KEY_ID replace-with-oss-access-key-or-skip
put_parameter ALIBABA_CLOUD_OSS_ACCESS_KEY_SECRET replace-with-oss-secret-or-skip
put_parameter ALIBABA_CLOUD_OSS_BUCKET_NAME replace-with-oss-bucket-or-skip
put_parameter ALIBABA_CLOUD_OSS_ENDPOINT replace-with-oss-endpoint-or-skip
put_parameter ALIBABA_CLOUD_OSS_PUBLIC_BASE_URL replace-with-oss-public-base-url-or-skip
put_parameter AWS_S3_REGION replace-with-s3-region-or-skip
put_parameter AWS_S3_ACCESS_KEY_ID replace-with-s3-access-key-or-skip
put_parameter AWS_S3_SECRET_ACCESS_KEY replace-with-s3-secret-or-skip
put_parameter AWS_S3_BUCKET_NAME replace-with-s3-bucket-or-skip
put_parameter AWS_S3_ENDPOINT_URL replace-with-s3-endpoint-or-skip
put_parameter HUGGINGFACE_STORAGE_NAMESPACE replace-with-hf-namespace-or-skip
put_parameter HUGGINGFACE_STORAGE_ACCESS_KEY_ID replace-with-hf-s3-access-key-or-skip
put_parameter HUGGINGFACE_STORAGE_SECRET_ACCESS_KEY replace-with-hf-s3-secret-key-or-skip
put_parameter HUGGINGFACE_STORAGE_BUCKET_NAME replace-with-hf-bucket-or-skip
put_parameter HUGGINGFACE_STORAGE_PUBLIC_BASE_URL replace-with-hf-public-base-url-or-skip
put_parameter MINIO_ENDPOINT_URL replace-with-minio-endpoint-or-skip
put_parameter MINIO_ACCESS_KEY_ID replace-with-minio-access-key-or-skip
put_parameter MINIO_SECRET_ACCESS_KEY replace-with-minio-secret-or-skip
put_parameter MINIO_BUCKET_NAME replace-with-minio-bucket-or-skip
put_parameter MINIO_REGION us-east-1
put_parameter MINIO_PUBLIC_BASE_URL replace-with-minio-public-base-url-or-skip
put_parameter SCALEWAY_OBJECT_STORAGE_REGION replace-with-scaleway-region-or-skip
put_parameter SCALEWAY_OBJECT_STORAGE_ACCESS_KEY_ID replace-with-scaleway-access-key-or-skip
put_parameter SCALEWAY_OBJECT_STORAGE_SECRET_ACCESS_KEY replace-with-scaleway-secret-or-skip
put_parameter SCALEWAY_OBJECT_STORAGE_BUCKET_NAME replace-with-scaleway-bucket-or-skip
put_parameter SCALEWAY_OBJECT_STORAGE_ENDPOINT_URL replace-with-scaleway-endpoint-or-skip
put_parameter SCALEWAY_OBJECT_STORAGE_PUBLIC_BASE_URL replace-with-scaleway-public-base-url-or-skip
put_parameter SPACES_REGION replace-with-spaces-region-or-skip
put_parameter SPACES_ACCESS_KEY_ID replace-with-spaces-access-key-or-skip
put_parameter SPACES_SECRET_ACCESS_KEY replace-with-spaces-secret-or-skip
put_parameter SPACES_BUCKET_NAME replace-with-spaces-bucket-or-skip
put_parameter SPACES_ENDPOINT_URL replace-with-spaces-endpoint-or-skip
put_parameter SPACES_PUBLIC_BASE_URL replace-with-spaces-public-base-url-or-skip
put_parameter BLOB_READ_WRITE_TOKEN replace-with-vercel-blob-token-or-skip
put_parameter NEXT_PUBLIC_SENTRY_DSN ''
put_parameter NEXT_PUBLIC_SENTRY_ENVIRONMENT production
put_parameter SENTRY_ORG replace-with-sentry-org
put_parameter SENTRY_PROJECT replace-with-sentry-project
```

Keep `SENTRY_AUTH_TOKEN` in CI or your build environment only when you intentionally upload source maps; it is not needed by the running EC2 container.

Unused BYOK provider parameters can be placeholders as long as you do not select those providers' models. The BabySea and Sentry values can be placeholders when you stay in BYOK mode and do not upload source maps.

### 5. Create the EC2 instance profile

The instance needs ECR read access and scoped SSM read access for only the parameter path. If you encrypt parameters with a customer-managed KMS key, add `kms:Decrypt` for that key to the inline policy.

```bash
cat >/tmp/marsha-ec2-trust-policy.json <<'JSON'
{
	"Version": "2012-10-17",
	"Statement": [
		{
			"Effect": "Allow",
			"Principal": { "Service": "ec2.amazonaws.com" },
			"Action": "sts:AssumeRole"
		}
	]
}
JSON

aws iam create-role \
	--role-name marsha-ec2 \
	--assume-role-policy-document file:///tmp/marsha-ec2-trust-policy.json || true

aws iam attach-role-policy \
	--role-name marsha-ec2 \
	--policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly

ACCOUNT_ID=$(aws sts get-caller-identity \
	--query Account \
	--output text)

cat >/tmp/marsha-ec2-ssm-policy.json <<JSON
{
	"Version": "2012-10-17",
	"Statement": [
		{
			"Effect": "Allow",
			"Action": [
				"ssm:GetParameter",
				"ssm:GetParameters",
				"ssm:GetParametersByPath"
			],
			"Resource": "arn:aws:ssm:$AWS_REGION:$ACCOUNT_ID:parameter${PARAMETER_PREFIX}/*"
		}
	]
}
JSON

aws iam put-role-policy \
	--role-name marsha-ec2 \
	--policy-name marsha-ec2-ssm-read \
	--policy-document file:///tmp/marsha-ec2-ssm-policy.json

aws iam create-instance-profile --instance-profile-name marsha-ec2 || true
aws iam add-role-to-instance-profile \
	--instance-profile-name marsha-ec2 \
	--role-name marsha-ec2 || true
```

Instance profile role propagation can take a minute after creation.

### 6. Launch the instance

The security group opens HTTP publicly and SSH only to your current IP. This matches the EC2 launch-and-connect model while limiting SSH exposure.

```bash
MY_IP=$(curl -fsS https://checkip.amazonaws.com)/32

aws ec2 create-key-pair \
	--region "$AWS_REGION" \
	--key-name "$KEY_NAME" \
	--query KeyMaterial \
	--output text >"$KEY_NAME.pem"
chmod 400 "$KEY_NAME.pem"

SECURITY_GROUP_ID=$(aws ec2 create-security-group \
	--region "$AWS_REGION" \
	--group-name marsha-ec2 \
	--description 'Marsha EC2 web and SSH access' \
	--vpc-id "$VPC_ID" \
	--query GroupId \
	--output text)

aws ec2 authorize-security-group-ingress \
	--region "$AWS_REGION" \
	--group-id "$SECURITY_GROUP_ID" \
	--protocol tcp \
	--port 80 \
	--cidr 0.0.0.0/0

aws ec2 authorize-security-group-ingress \
	--region "$AWS_REGION" \
	--group-id "$SECURITY_GROUP_ID" \
	--protocol tcp \
	--port 22 \
	--cidr "$MY_IP"

AMI_ID=$(aws ssm get-parameter \
	--region "$AWS_REGION" \
	--name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
	--query 'Parameter.Value' \
	--output text)

cp .aws/ec2-user-data.sh /tmp/marsha-ec2-user-data.sh
perl -0pi \
	-e "s#__APP_IMAGE_URI__#$REPOSITORY_URI:latest#g" \
	-e "s#__APP_PARAMETER_PREFIX__#$PARAMETER_PREFIX#g" \
	-e "s#__APP_SITE_URL__#$SITE_URL#g" \
	-e "s#__APP_AWS_REGION__#$AWS_REGION#g" \
	/tmp/marsha-ec2-user-data.sh

INSTANCE_ID=$(aws ec2 run-instances \
	--region "$AWS_REGION" \
	--image-id "$AMI_ID" \
	--instance-type t3.small \
	--key-name "$KEY_NAME" \
	--iam-instance-profile Name=marsha-ec2 \
	--subnet-id "$SUBNET_ID" \
	--security-group-ids "$SECURITY_GROUP_ID" \
	--associate-public-ip-address \
	--user-data file:///tmp/marsha-ec2-user-data.sh \
	--tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=marsha}]' \
	--query 'Instances[0].InstanceId' \
	--output text)

aws ec2 wait instance-running \
	--region "$AWS_REGION" \
	--instance-ids "$INSTANCE_ID"

aws ec2 associate-address \
	--region "$AWS_REGION" \
	--instance-id "$INSTANCE_ID" \
	--allocation-id "$ALLOCATION_ID"
```

Open `http://$ELASTIC_IP`.

### 7. Verify and inspect

```bash
curl -fsS "${SITE_URL%/}/api/health" >/dev/null
ssh -i "$KEY_NAME.pem" "ec2-user@$ELASTIC_IP"
```

On the instance:

```bash
sudo cloud-init status --long
sudo docker ps --filter name=marsha
sudo docker logs --tail=100 marsha
sudo systemctl status marsha-cron.timer
sudo systemctl list-timers marsha-cron.timer
```

The user-data script installs Docker, runs the container on host port 80, writes `/opt/marsha/marsha.env` with mode `0600`, and creates the systemd timer that calls `/api/cron/process-runs` locally.

### 8. Update the running instance

Build and push a new image tag:

```bash
IMAGE_TAG=$(git rev-parse --short HEAD)

docker build \
	--build-arg NEXT_PUBLIC_SITE_URL="$SITE_URL" \
	-t "marsha:$IMAGE_TAG" .

docker tag "marsha:$IMAGE_TAG" "$REPOSITORY_URI:$IMAGE_TAG"
docker push "$REPOSITORY_URI:$IMAGE_TAG"
```

Then connect to EC2 and replace the container:

```bash
ssh -i "$KEY_NAME.pem" "ec2-user@$ELASTIC_IP"
```

```bash
export AWS_REGION=us-east-1
export IMAGE_URI=123456789012.dkr.ecr.us-east-1.amazonaws.com/marsha:replace-with-tag

aws ecr get-login-password --region "$AWS_REGION" | \
	sudo docker login --username AWS --password-stdin "${IMAGE_URI%/*}"

sudo docker pull "$IMAGE_URI"
sudo docker rm -f marsha
sudo docker run \
	--detach \
	--name marsha \
	--restart unless-stopped \
	--env-file /opt/marsha/marsha.env \
	--publish 80:3000 \
	"$IMAGE_URI"
```

For major changes, it is often cleaner to launch a replacement instance from fresh user data, move the Elastic IP, then terminate the old instance.

### 9. Clean up

When finished, terminate the instance and release the Elastic IP:

```bash
aws ec2 terminate-instances \
	--region "$AWS_REGION" \
	--instance-ids "$INSTANCE_ID"

aws ec2 wait instance-terminated \
	--region "$AWS_REGION" \
	--instance-ids "$INSTANCE_ID"

aws ec2 release-address \
	--region "$AWS_REGION" \
	--allocation-id "$ALLOCATION_ID"
```

Optionally delete the security group, key pair, SSM parameters, ECR images, ECR repository, IAM role policy, IAM role, and instance profile.

## Troubleshooting

| Symptom               | Check                                                                                                                                              |
| :-------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------- |
| User data exits early | SSH in and run `sudo cloud-init status --long` and `sudo tail -n 200 /var/log/cloud-init-output.log`.                                              |
| Container is missing  | Check that placeholders were rendered in `/tmp/marsha-ec2-user-data.sh` before launch.                                                             |
| ECR pull fails        | Confirm the instance profile has `AmazonEC2ContainerRegistryReadOnly` and ECR login can reach the registry.                                        |
| SSM load fails        | Confirm the inline policy contains `ssm:GetParametersByPath` for `arn:aws:ssm:$AWS_REGION:$ACCOUNT_ID:parameter${PARAMETER_PREFIX}/*`.             |
| BYOK startup fails    | Add at least one BYOK inference key under the Parameter Store path, and make sure the keys match the providers used by your selected chain models. |
| Runs stay queued      | Check `sudo systemctl status marsha-cron.timer` and `sudo journalctl -u marsha-cron.service`.                                                      |
| Public URL is wrong   | Rebuild with the final `SITE_URL`, push the image, and replace the container or instance.                                                          |

import { z } from 'zod';

import { AppError } from './errors';

const BABYSEA_API_HOSTS = new Set([
  'api.us.babysea.ai',
  'api.eu.babysea.ai',
  'api.jp.babysea.ai',
]);

const OptionalNonEmptyStringSchema = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().min(1).optional(),
);
const OptionalProviderKeySchema = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().min(8).max(512).optional(),
);
const OptionalLongSecretSchema = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().min(8).max(8192).optional(),
);
const OptionalUrlSchema = z.preprocess(
  emptyStringToUndefined,
  z.url().trim().optional(),
);

const EnvSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.url().trim(),
  APP_DATABASE: z.preprocess(
    emptyStringToUndefined,
    z.enum(['aurora', 'polardb']).default('aurora'),
  ),
  DATABASE_URL: z.string().trim().min(1),
  APP_API_KEY: z.string().trim().min(1),
  APP_CRON_SECRET: z.string().trim().min(1),
  APP_CALLBACK_SECRET: z.string().trim().min(1),
  APP_PROVIDER_MODE: z.preprocess(
    emptyStringToUndefined,
    z.enum(['byok', 'babysea']).default('byok'),
  ),
  DASHSCOPE_API_KEY: OptionalProviderKeySchema,
  BFL_API_KEY: OptionalProviderKeySchema,
  BFL_REGION: z.preprocess(
    emptyStringToUndefined,
    z.enum(['global', 'eu', 'us']).optional(),
  ),
  BFL_API_BASE_URL: OptionalUrlSchema,
  ARK_API_KEY: OptionalProviderKeySchema,
  GEMINI_API_KEY: OptionalProviderKeySchema,
  GOOGLE_API_KEY: OptionalProviderKeySchema,
  OPENAI_API_KEY: OptionalProviderKeySchema,
  RUNWAYML_API_SECRET: OptionalProviderKeySchema,
  BABYSEA_API_KEY: OptionalNonEmptyStringSchema,
  BABYSEA_REGION: z.preprocess(
    emptyStringToUndefined,
    z.enum(['us', 'eu', 'jp']).optional(),
  ),
  BABYSEA_API_BASE_URL: OptionalUrlSchema,
  BABYSEA_WEBHOOK_SECRET: OptionalNonEmptyStringSchema,
  AGENT_CHAIN_AWS_BEDROCK_TOKEN: OptionalLongSecretSchema,
  AGENT_CHAIN_AWS_BEDROCK_REGION: OptionalNonEmptyStringSchema,
  AGENT_CHAIN_AWS_BEDROCK_AGENT: OptionalNonEmptyStringSchema,
  APP_STORAGE_PROVIDER: z.preprocess(
    emptyStringToUndefined,
    z
      .enum([
        'none',
        'alibaba-cloud-oss',
        'aws-s3',
        'backblaze-b2',
        'cloudflare-r2',
        'huggingface-storage-buckets',
        'minio',
        'scaleway-object-storage',
        'spaces-object-storage',
        'vercel-blob',
      ])
      .default('none'),
  ),
  ALIBABA_CLOUD_OSS_REGION: OptionalNonEmptyStringSchema,
  ALIBABA_CLOUD_OSS_ACCESS_KEY_ID: OptionalNonEmptyStringSchema,
  ALIBABA_CLOUD_OSS_ACCESS_KEY_SECRET: OptionalLongSecretSchema,
  ALIBABA_CLOUD_OSS_BUCKET_NAME: OptionalNonEmptyStringSchema,
  ALIBABA_CLOUD_OSS_ENDPOINT: OptionalNonEmptyStringSchema,
  ALIBABA_CLOUD_OSS_PUBLIC_BASE_URL: OptionalUrlSchema,
  AWS_S3_REGION: OptionalNonEmptyStringSchema,
  AWS_S3_ACCESS_KEY_ID: OptionalNonEmptyStringSchema,
  AWS_S3_SECRET_ACCESS_KEY: OptionalLongSecretSchema,
  AWS_S3_BUCKET_NAME: OptionalNonEmptyStringSchema,
  AWS_S3_ENDPOINT_URL: OptionalUrlSchema,
  BACKBLAZE_B2_KEY_ID: OptionalNonEmptyStringSchema,
  BACKBLAZE_B2_APPLICATION_KEY: OptionalLongSecretSchema,
  BACKBLAZE_B2_BUCKET_NAME: OptionalNonEmptyStringSchema,
  BACKBLAZE_B2_BUCKET_ID: OptionalNonEmptyStringSchema,
  BACKBLAZE_B2_PUBLIC_BASE_URL: OptionalUrlSchema,
  B2_KEY_ID: OptionalNonEmptyStringSchema,
  B2_APP_KEY: OptionalLongSecretSchema,
  B2_BUCKET_NAME: OptionalNonEmptyStringSchema,
  CLOUDFLARE_R2_ACCOUNT_ID: OptionalNonEmptyStringSchema,
  CLOUDFLARE_R2_ACCESS_KEY_ID: OptionalNonEmptyStringSchema,
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: OptionalLongSecretSchema,
  CLOUDFLARE_R2_BUCKET_NAME: OptionalNonEmptyStringSchema,
  CLOUDFLARE_R2_ENDPOINT_URL: OptionalUrlSchema,
  CLOUDFLARE_R2_CUSTOM_DOMAIN_URL: OptionalUrlSchema,
  HUGGINGFACE_STORAGE_NAMESPACE: OptionalNonEmptyStringSchema,
  HUGGINGFACE_STORAGE_ACCESS_KEY_ID: OptionalNonEmptyStringSchema,
  HUGGINGFACE_STORAGE_SECRET_ACCESS_KEY: OptionalLongSecretSchema,
  HUGGINGFACE_STORAGE_BUCKET_NAME: OptionalNonEmptyStringSchema,
  HUGGINGFACE_STORAGE_PUBLIC_BASE_URL: OptionalUrlSchema,
  MINIO_ENDPOINT_URL: OptionalUrlSchema,
  MINIO_ACCESS_KEY_ID: OptionalNonEmptyStringSchema,
  MINIO_SECRET_ACCESS_KEY: OptionalLongSecretSchema,
  MINIO_BUCKET_NAME: OptionalNonEmptyStringSchema,
  MINIO_REGION: OptionalNonEmptyStringSchema,
  MINIO_PUBLIC_BASE_URL: OptionalUrlSchema,
  SCALEWAY_OBJECT_STORAGE_REGION: OptionalNonEmptyStringSchema,
  SCALEWAY_OBJECT_STORAGE_ACCESS_KEY_ID: OptionalNonEmptyStringSchema,
  SCALEWAY_OBJECT_STORAGE_SECRET_ACCESS_KEY: OptionalLongSecretSchema,
  SCALEWAY_OBJECT_STORAGE_BUCKET_NAME: OptionalNonEmptyStringSchema,
  SCALEWAY_OBJECT_STORAGE_ENDPOINT_URL: OptionalUrlSchema,
  SCALEWAY_OBJECT_STORAGE_PUBLIC_BASE_URL: OptionalUrlSchema,
  SPACES_REGION: OptionalNonEmptyStringSchema,
  SPACES_ACCESS_KEY_ID: OptionalNonEmptyStringSchema,
  SPACES_SECRET_ACCESS_KEY: OptionalLongSecretSchema,
  SPACES_BUCKET_NAME: OptionalNonEmptyStringSchema,
  SPACES_ENDPOINT_URL: OptionalUrlSchema,
  SPACES_PUBLIC_BASE_URL: OptionalUrlSchema,
  BLOB_READ_WRITE_TOKEN: OptionalLongSecretSchema,
});

export type AppEnv = z.infer<typeof EnvSchema>;

let cachedEnv: AppEnv | null = null;

export function getEnv() {
  if (cachedEnv) {
    return cachedEnv;
  }

  const result = EnvSchema.safeParse(process.env);

  if (!result.success) {
    throw toConfigurationError(result.error);
  }

  const parsed = result.data;
  const baseUrl = parsed.BABYSEA_API_BASE_URL?.trim();

  if (baseUrl) {
    const url = new URL(baseUrl);

    if (url.protocol !== 'https:') {
      throw new Error('BABYSEA_API_BASE_URL must use HTTPS.');
    }

    if (!BABYSEA_API_HOSTS.has(url.hostname.toLowerCase())) {
      throw new Error('BABYSEA_API_BASE_URL must be a BabySea API host.');
    }
  }

  const bflBase = parsed.BFL_API_BASE_URL?.trim();
  if (bflBase) {
    const url = new URL(bflBase);
    if (url.protocol !== 'https:') {
      throw new Error('BFL_API_BASE_URL must use HTTPS.');
    }
    if (!url.hostname.toLowerCase().endsWith('.bfl.ai')) {
      throw new Error('BFL_API_BASE_URL host must end with .bfl.ai.');
    }
  }

  cachedEnv = parsed;
  return parsed;
}

function toConfigurationError(error: z.ZodError) {
  const missing = error.issues
    .filter(isMissingEnvIssue)
    .map((issue) => issue.path.join('.'))
    .filter(Boolean);
  const invalid = error.issues
    .filter((issue) => !missing.includes(issue.path.join('.')))
    .map((issue) => issue.path.join('.'))
    .filter(Boolean);
  const message = missing.length
    ? `The app is missing required environment variables: ${missing.join(', ')}.`
    : 'The app environment variables are invalid.';

  return new AppError('configuration_error', message, 500, {
    invalid,
    missing,
  });
}

function isMissingEnvIssue(issue: z.ZodIssue) {
  return (
    issue.code === 'invalid_type' &&
    ((issue as { input?: unknown }).input === undefined ||
      (issue as { received?: string }).received === 'undefined')
  );
}

export function getAppApiKeys() {
  const apiKeys = getEnv()
    .APP_API_KEY.split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);

  const prefixes = new Set<string>();

  for (const apiKey of apiKeys) {
    const prefix = apiKey.length <= 12 ? apiKey : apiKey.slice(0, 12);

    if (prefixes.has(prefix)) {
      throw new Error('APP_API_KEY must have unique 12-character prefixes.');
    }

    prefixes.add(prefix);
  }

  return apiKeys;
}

function emptyStringToUndefined(value: unknown) {
  return value === '' || value === null ? undefined : value;
}

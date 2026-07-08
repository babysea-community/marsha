import 'server-only';

import { createS3CompatibleStorageProvider } from './tools/s3-compatible';
import type { StorageProvider } from './types';

export function createMinIO(): StorageProvider {
  const endpoint = parseRequiredUrl('MINIO_ENDPOINT_URL');
  const bucket = required(process.env.MINIO_BUCKET_NAME, 'MINIO_BUCKET_NAME');
  const publicBaseUrl = optional(process.env.MINIO_PUBLIC_BASE_URL);

  return createS3CompatibleStorageProvider({
    id: 'minio',
    label: `minio · ${bucket}`,
    config: {
      accessKeyId: required(
        process.env.MINIO_ACCESS_KEY_ID,
        'MINIO_ACCESS_KEY_ID',
      ),
      bucket,
      endpoint,
      forcePathStyle: true,
      publicBaseUrl: publicBaseUrl ?? buildPathStyleBaseUrl(endpoint, bucket),
      region: optional(process.env.MINIO_REGION) ?? 'us-east-1',
      secretAccessKey: required(
        process.env.MINIO_SECRET_ACCESS_KEY,
        'MINIO_SECRET_ACCESS_KEY',
      ),
    },
  });
}

function buildPathStyleBaseUrl(endpoint: string, bucket: string) {
  return `${endpoint.replace(/\/+$/, '')}/${encodeURIComponent(bucket)}`;
}

function parseRequiredUrl(name: string) {
  const value = required(process.env[name], name);
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${name} must use HTTP or HTTPS.`);
  }

  if (url.username || url.password) {
    throw new Error(`${name} must not include credentials.`);
  }

  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';

  return url.toString().replace(/\/+$/, '');
}

function required(value: string | undefined, name: string) {
  const trimmed = value?.trim();

  if (!trimmed) {
    throw new Error(`${name} is required when APP_STORAGE_PROVIDER=minio.`);
  }

  return trimmed;
}

function optional(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

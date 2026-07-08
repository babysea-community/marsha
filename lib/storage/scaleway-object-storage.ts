import 'server-only';

import { createS3CompatibleStorageProvider } from './tools/s3-compatible';
import type { StorageProvider } from './types';

export function createScalewayObjectStorage(): StorageProvider {
  const region = required(
    process.env.SCALEWAY_OBJECT_STORAGE_REGION,
    'SCALEWAY_OBJECT_STORAGE_REGION',
  );
  const bucket = required(
    process.env.SCALEWAY_OBJECT_STORAGE_BUCKET_NAME,
    'SCALEWAY_OBJECT_STORAGE_BUCKET_NAME',
  );
  const endpoint =
    optional(process.env.SCALEWAY_OBJECT_STORAGE_ENDPOINT_URL) ??
    `https://s3.${region}.scw.cloud`;
  const publicBaseUrl =
    optional(process.env.SCALEWAY_OBJECT_STORAGE_PUBLIC_BASE_URL) ??
    `https://${bucket}.s3.${region}.scw.cloud`;

  return createS3CompatibleStorageProvider({
    id: 'scaleway-object-storage',
    label: `scaleway-object-storage · ${bucket}`,
    config: {
      accessKeyId: required(
        process.env.SCALEWAY_OBJECT_STORAGE_ACCESS_KEY_ID,
        'SCALEWAY_OBJECT_STORAGE_ACCESS_KEY_ID',
      ),
      bucket,
      endpoint: parseUrl(endpoint, 'SCALEWAY_OBJECT_STORAGE_ENDPOINT_URL'),
      publicBaseUrl: parseUrl(
        publicBaseUrl,
        'SCALEWAY_OBJECT_STORAGE_PUBLIC_BASE_URL',
      ),
      region,
      secretAccessKey: required(
        process.env.SCALEWAY_OBJECT_STORAGE_SECRET_ACCESS_KEY,
        'SCALEWAY_OBJECT_STORAGE_SECRET_ACCESS_KEY',
      ),
    },
  });
}

function parseUrl(value: string, name: string) {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }

  if (url.protocol !== 'https:') {
    throw new Error(`${name} must use HTTPS.`);
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
    throw new Error(
      `${name} is required when APP_STORAGE_PROVIDER=scaleway-object-storage.`,
    );
  }

  return trimmed;
}

function optional(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

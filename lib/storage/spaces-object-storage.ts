import 'server-only';

import { createS3CompatibleStorageProvider } from './tools/s3-compatible';
import type { StorageProvider } from './types';

export function createSpacesObjectStorage(): StorageProvider {
  const region = required(process.env.SPACES_REGION, 'SPACES_REGION');
  const bucket = required(process.env.SPACES_BUCKET_NAME, 'SPACES_BUCKET_NAME');
  const endpoint =
    optional(process.env.SPACES_ENDPOINT_URL) ??
    `https://${region}.digitaloceanspaces.com`;
  const publicBaseUrl =
    optional(process.env.SPACES_PUBLIC_BASE_URL) ??
    `https://${bucket}.${region}.digitaloceanspaces.com`;

  return createS3CompatibleStorageProvider({
    id: 'spaces-object-storage',
    label: `spaces-object-storage · ${bucket}`,
    config: {
      accessKeyId: required(
        process.env.SPACES_ACCESS_KEY_ID,
        'SPACES_ACCESS_KEY_ID',
      ),
      bucket,
      endpoint: parseUrl(endpoint, 'SPACES_ENDPOINT_URL'),
      publicBaseUrl: parseUrl(publicBaseUrl, 'SPACES_PUBLIC_BASE_URL'),
      region,
      secretAccessKey: required(
        process.env.SPACES_SECRET_ACCESS_KEY,
        'SPACES_SECRET_ACCESS_KEY',
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
      `${name} is required when APP_STORAGE_PROVIDER=spaces-object-storage.`,
    );
  }

  return trimmed;
}

function optional(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

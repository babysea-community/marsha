import 'server-only';

import { createS3CompatibleStorageProvider } from './tools/s3-compatible';
import type { StorageProvider } from './types';

export function createCloudflareR2(): StorageProvider {
  const accountId = required(
    process.env.CLOUDFLARE_R2_ACCOUNT_ID,
    'CLOUDFLARE_R2_ACCOUNT_ID',
  );
  const bucket = required(
    process.env.CLOUDFLARE_R2_BUCKET_NAME,
    'CLOUDFLARE_R2_BUCKET_NAME',
  );
  const endpoint = parseCloudflareR2Endpoint({
    accountId,
    bucket,
    endpointUrl: required(
      process.env.CLOUDFLARE_R2_ENDPOINT_URL,
      'CLOUDFLARE_R2_ENDPOINT_URL',
    ),
  });

  return createS3CompatibleStorageProvider({
    id: 'cloudflare-r2',
    label: `cloudflare-r2 · ${bucket}`,
    config: {
      accessKeyId: required(
        process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
        'CLOUDFLARE_R2_ACCESS_KEY_ID',
      ),
      bucket,
      endpoint: endpoint.s3Endpoint,
      forcePathStyle: true,
      publicBaseUrl: parseCloudflareR2PublicBaseUrl(
        required(
          process.env.CLOUDFLARE_R2_CUSTOM_DOMAIN_URL,
          'CLOUDFLARE_R2_CUSTOM_DOMAIN_URL',
        ),
      ),
      region: 'auto',
      secretAccessKey: required(
        process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
        'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
      ),
    },
  });
}

export function parseCloudflareR2Endpoint(input: {
  accountId: string;
  bucket: string;
  endpointUrl: string;
}) {
  const { accountId, bucket, endpointUrl } = input;
  let url: URL;

  try {
    url = new URL(endpointUrl);
  } catch {
    throw new Error('CLOUDFLARE_R2_ENDPOINT_URL must be a valid URL.');
  }

  if (url.protocol !== 'https:') {
    throw new Error('CLOUDFLARE_R2_ENDPOINT_URL must use HTTPS.');
  }

  if (url.username || url.password) {
    throw new Error('CLOUDFLARE_R2_ENDPOINT_URL must not include credentials.');
  }

  const hostname = url.hostname.toLowerCase();
  const normalizedAccountId = accountId.toLowerCase();
  const isCloudflareR2Host =
    hostname.startsWith(`${normalizedAccountId}.`) &&
    hostname.endsWith('.r2.cloudflarestorage.com');

  if (!isCloudflareR2Host) {
    throw new Error(
      'CLOUDFLARE_R2_ENDPOINT_URL must be the Cloudflare R2 S3 API endpoint for CLOUDFLARE_R2_ACCOUNT_ID.',
    );
  }

  const endpointBucket = bucketFromEndpointPath(url.pathname);

  if (endpointBucket && endpointBucket !== bucket) {
    throw new Error(
      'CLOUDFLARE_R2_ENDPOINT_URL bucket path must match CLOUDFLARE_R2_BUCKET_NAME.',
    );
  }

  url.pathname = '';
  url.search = '';
  url.hash = '';

  return {
    s3Endpoint: url.toString().replace(/\/+$/, ''),
  };
}

export function parseCloudflareR2PublicBaseUrl(value: string) {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error('CLOUDFLARE_R2_CUSTOM_DOMAIN_URL must be a valid URL.');
  }

  if (url.protocol !== 'https:') {
    throw new Error('CLOUDFLARE_R2_CUSTOM_DOMAIN_URL must use HTTPS.');
  }

  if (url.username || url.password) {
    throw new Error(
      'CLOUDFLARE_R2_CUSTOM_DOMAIN_URL must not include credentials.',
    );
  }

  if (url.hostname.toLowerCase().endsWith('.r2.cloudflarestorage.com')) {
    throw new Error(
      'CLOUDFLARE_R2_CUSTOM_DOMAIN_URL must be an R2 public domain, not the Cloudflare R2 S3 API endpoint.',
    );
  }

  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';

  return url.toString().replace(/\/+$/, '');
}

function bucketFromEndpointPath(pathname: string) {
  const trimmed = pathname.replace(/^\/+|\/+$/g, '');

  if (!trimmed) {
    return null;
  }

  if (trimmed.includes('/')) {
    throw new Error(
      'CLOUDFLARE_R2_ENDPOINT_URL can include only the bucket path, for example https://<account-id>.r2.cloudflarestorage.com/marsha-media.',
    );
  }

  return decodeURIComponent(trimmed);
}

function required(value: string | undefined, name: string) {
  const trimmed = value?.trim();

  if (!trimmed) {
    throw new Error(
      `${name} is required when APP_STORAGE_PROVIDER=cloudflare-r2.`,
    );
  }

  return trimmed;
}

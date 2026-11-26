import 'server-only';

import { createS3CompatibleStorageProvider } from './tools/s3-compatible';
import type { StorageProvider } from './types';

const HUGGINGFACE_S3_REGION = 'us-east-1';

export function createHuggingFaceStorageBuckets(): StorageProvider {
  const namespace = required(
    process.env.HUGGINGFACE_STORAGE_NAMESPACE,
    'HUGGINGFACE_STORAGE_NAMESPACE',
  );
  const bucket = required(
    process.env.HUGGINGFACE_STORAGE_BUCKET_NAME,
    'HUGGINGFACE_STORAGE_BUCKET_NAME',
  );
  const endpoint = `https://s3.hf.co/${encodeURIComponent(namespace)}`;
  const publicBaseUrl =
    optional(process.env.HUGGINGFACE_STORAGE_PUBLIC_BASE_URL) ??
    `${endpoint}/${encodeURIComponent(bucket)}`;

  assertPlainSegment(namespace, 'HUGGINGFACE_STORAGE_NAMESPACE');
  assertPlainSegment(bucket, 'HUGGINGFACE_STORAGE_BUCKET_NAME');

  return createS3CompatibleStorageProvider({
    id: 'huggingface-storage-buckets',
    label: `huggingface-storage-buckets · ${namespace}/${bucket}`,
    config: {
      accessKeyId: required(
        process.env.HUGGINGFACE_STORAGE_ACCESS_KEY_ID,
        'HUGGINGFACE_STORAGE_ACCESS_KEY_ID',
      ),
      bucket,
      endpoint,
      forcePathStyle: true,
      publicBaseUrl: parsePublicBaseUrl(publicBaseUrl),
      region: HUGGINGFACE_S3_REGION,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      secretAccessKey: required(
        process.env.HUGGINGFACE_STORAGE_SECRET_ACCESS_KEY,
        'HUGGINGFACE_STORAGE_SECRET_ACCESS_KEY',
      ),
    },
  });
}

function parsePublicBaseUrl(value: string) {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error('HUGGINGFACE_STORAGE_PUBLIC_BASE_URL must be a valid URL.');
  }

  if (url.protocol !== 'https:') {
    throw new Error('HUGGINGFACE_STORAGE_PUBLIC_BASE_URL must use HTTPS.');
  }

  if (url.username || url.password) {
    throw new Error(
      'HUGGINGFACE_STORAGE_PUBLIC_BASE_URL must not include credentials.',
    );
  }

  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';

  return url.toString().replace(/\/+$/, '');
}

function assertPlainSegment(value: string, name: string) {
  if (value.includes('/')) {
    throw new Error(`${name} must not include slashes.`);
  }
}

function required(value: string | undefined, name: string) {
  const trimmed = value?.trim();

  if (!trimmed) {
    throw new Error(
      `${name} is required when APP_STORAGE_PROVIDER=huggingface-storage-buckets.`,
    );
  }

  return trimmed;
}

function optional(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

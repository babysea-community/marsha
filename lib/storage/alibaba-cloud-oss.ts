import 'server-only';

import { Buffer } from 'node:buffer';

import OSS from 'ali-oss';

import type { AppStorageProviderId, StorageProvider } from './types';

const PROVIDER_ID: AppStorageProviderId = 'alibaba-cloud-oss';
const LIST_PAGE_SIZE = 1000;

/**
 * Alibaba Cloud Object Storage Service (OSS) storage provider. Completed step
 * outputs are copied into your OSS bucket and served from a public base URL
 * (the bucket's public endpoint or an optional CDN domain via
 * `ALIBABA_CLOUD_OSS_PUBLIC_BASE_URL`). Credentials stay server-side; callers only ever hold
 * a Marsha API key.
 */
export function createAlibabaCloudOss(): StorageProvider {
  const region = required(
    process.env.ALIBABA_CLOUD_OSS_REGION,
    'ALIBABA_CLOUD_OSS_REGION',
  );
  const accessKeyId = required(
    process.env.ALIBABA_CLOUD_OSS_ACCESS_KEY_ID,
    'ALIBABA_CLOUD_OSS_ACCESS_KEY_ID',
  );
  const accessKeySecret = required(
    process.env.ALIBABA_CLOUD_OSS_ACCESS_KEY_SECRET,
    'ALIBABA_CLOUD_OSS_ACCESS_KEY_SECRET',
  );
  const bucket = required(
    process.env.ALIBABA_CLOUD_OSS_BUCKET_NAME,
    'ALIBABA_CLOUD_OSS_BUCKET_NAME',
  );
  const endpoint = optional(process.env.ALIBABA_CLOUD_OSS_ENDPOINT);
  const publicBaseUrl = resolvePublicBaseUrl({ region, bucket, endpoint });

  const client = new OSS({
    region,
    accessKeyId,
    accessKeySecret,
    bucket,
    secure: true,
    ...(endpoint ? { endpoint } : {}),
  });

  return {
    id: PROVIDER_ID,
    label: `alibaba-cloud-oss · ${bucket}`,
    async store({ contentType, data, key }) {
      await client.put(key, Buffer.from(data), {
        mime: contentType,
        headers: { 'x-oss-object-acl': 'public-read' },
      });

      return {
        publicUrl: `${publicBaseUrl}/${encodeStoragePath(key)}`,
        storagePath: key,
      };
    },
    async remove(keys) {
      const valid = keys.filter(
        (key) => typeof key === 'string' && key.length > 0,
      );

      if (valid.length === 0) {
        return;
      }

      try {
        await client.deleteMulti(valid, { quiet: true });
      } catch {
        // Best-effort: already-missing objects and transient errors are ignored.
      }
    },
    async removeByPrefix(prefix) {
      try {
        let marker: string | undefined;

        do {
          const listing = await client.list(
            { prefix, 'max-keys': LIST_PAGE_SIZE, marker },
            {},
          );
          const keys = (listing.objects ?? [])
            .map((object) => object.name)
            .filter((name): name is string => Boolean(name));

          if (keys.length > 0) {
            await client.deleteMulti(keys, { quiet: true });
          }

          marker = listing.nextMarker ?? undefined;
        } while (marker);
      } catch {
        // Best-effort: a disabled/misconfigured provider is a no-op.
      }
    },
  };
}

function resolvePublicBaseUrl(input: {
  region: string;
  bucket: string;
  endpoint?: string;
}) {
  const explicit = optional(process.env.ALIBABA_CLOUD_OSS_PUBLIC_BASE_URL);

  if (explicit) {
    return explicit.replace(/\/+$/, '');
  }

  if (input.endpoint) {
    const host = input.endpoint.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    return `https://${input.bucket}.${host}`;
  }

  return `https://${input.bucket}.${input.region}.aliyuncs.com`;
}

function encodeStoragePath(key: string) {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function required(value: string | undefined, name: string) {
  const trimmed = optional(value);

  if (!trimmed) {
    throw new Error(
      `${name} is required when APP_STORAGE_PROVIDER=alibaba-cloud-oss.`,
    );
  }

  return trimmed;
}

function optional(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

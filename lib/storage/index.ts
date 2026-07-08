import 'server-only';

import { Buffer } from 'node:buffer';
import type { LookupAddress } from 'node:dns';
import type { IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { extname } from 'node:path';

import { parseDataUrlOutputFile } from '@/lib/chains/output-files';
import { lookupAllowedNetworkAddress } from '@/lib/security/network-safety';
import {
  VIDEO_FFMPEG_PATH,
  VIDEO_TRIM_LEAD_IN_MS,
} from '@/lib/config/natural-video';

import { createAlibabaCloudOss } from './alibaba-cloud-oss';
import { createAwsS3 } from './aws-s3';
import { createBackblazeB2 } from './backblaze-b2';
import { createCloudflareR2 } from './cloudflare-r2';
import { createHuggingFaceStorageBuckets } from './huggingface-storage-buckets';
import { createMinIO } from './minio';
import { createScalewayObjectStorage } from './scaleway-object-storage';
import { createSpacesObjectStorage } from './spaces-object-storage';
import { createVercelBlob } from './vercel-blob';
import { invalidateRunCdnCache } from './tools/cloudfront';
import type { AppStorageProviderId, StorageProvider } from './types';
import { trimVideoLeadIn } from './tools/video-trim';

export type { AppStorageProviderId, StorageProvider } from './types';

const MAX_OUTPUT_STORAGE_BYTES = 200 * 1024 * 1024;
const OUTPUT_FETCH_TIMEOUT_MS = 60_000;
// Send a User-Agent so CDNs/WAFs (e.g. AWS WAF Core Rule Set fronting
// CloudFront, or Vercel Blob) don't reject the download with a 403.
const OUTPUT_DOWNLOAD_USER_AGENT = 'Marsha/0.1';

export type PersistOutputFilesResult = {
  outputFiles: string[];
  storageMetadata: {
    assets: Array<{
      byte_length: number;
      content_type: string;
      original_url: string;
      output_index: number;
      provider: AppStorageProviderId;
      storage_path: string;
      url: string;
    }>;
    provider: AppStorageProviderId;
  } | null;
};

export async function persistOutputFiles(input: {
  outputFiles: string[];
  provider?: StorageProvider | null;
  runId: string;
  stepKey: string;
}): Promise<PersistOutputFilesResult> {
  const provider = resolveProviderForPersistence(input);

  if (!provider || input.outputFiles.length === 0) {
    return { outputFiles: input.outputFiles, storageMetadata: null };
  }

  const outputFiles: string[] = [];
  const assets: NonNullable<
    PersistOutputFilesResult['storageMetadata']
  >['assets'] = [];

  for (const [index, outputFile] of input.outputFiles.entries()) {
    try {
      const media = await readOutputMedia(outputFile);
      const bytes =
        VIDEO_TRIM_LEAD_IN_MS > 0
          ? await trimVideoLeadIn({
              bytes: media.bytes,
              contentType: media.contentType,
              leadInMs: VIDEO_TRIM_LEAD_IN_MS,
              ffmpegPath: VIDEO_FFMPEG_PATH,
            })
          : media.bytes;
      const extension = extensionForContentType(media.contentType, outputFile);
      const key = `runs/${input.runId}/${input.stepKey}/output-${index}.${extension}`;
      const stored = await provider.store({
        contentType: media.contentType,
        data: bytes,
        key,
      });
      const url = stored.publicUrl ?? outputFile;

      outputFiles.push(url);
      assets.push({
        byte_length: bytes.byteLength,
        content_type: media.contentType,
        original_url: safeStorageOriginalReference(outputFile),
        output_index: index,
        provider: provider.id,
        storage_path: stored.storagePath,
        url,
      });
    } catch (error) {
      console.warn('[marsha] output storage failed; using original output', {
        error: error instanceof Error ? error.message : String(error),
        index,
        provider: provider.id,
        stepKey: input.stepKey,
      });
      outputFiles.push(outputFile);
    }
  }

  return {
    outputFiles,
    storageMetadata:
      assets.length > 0 ? { assets, provider: provider.id } : null,
  };
}

function resolveProviderForPersistence(input: {
  provider?: StorageProvider | null;
  outputFiles: string[];
}) {
  if ('provider' in input) {
    return input.provider ?? null;
  }

  try {
    return resolveOutputStorageProvider();
  } catch (error) {
    console.warn('[marsha] output storage unavailable; using originals', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export function resolveOutputStorageProvider(): StorageProvider | null {
  const provider = process.env.APP_STORAGE_PROVIDER?.trim() || 'none';

  switch (provider) {
    case 'none':
      return null;
    case 'alibaba-cloud-oss':
      return createAlibabaCloudOss();
    case 'aws-s3':
      return createAwsS3();
    case 'backblaze-b2':
      return createBackblazeB2();
    case 'cloudflare-r2':
      return createCloudflareR2();
    case 'huggingface-storage-buckets':
      return createHuggingFaceStorageBuckets();
    case 'minio':
      return createMinIO();
    case 'scaleway-object-storage':
      return createScalewayObjectStorage();
    case 'spaces-object-storage':
      return createSpacesObjectStorage();
    case 'vercel-blob':
      return createVercelBlob();
    default:
      throw new Error(
        'APP_STORAGE_PROVIDER must be none, alibaba-cloud-oss, aws-s3, backblaze-b2, cloudflare-r2, huggingface-storage-buckets, minio, scaleway-object-storage, spaces-object-storage, or vercel-blob.',
      );
  }
}

export type StoredAssetReference = {
  provider: AppStorageProviderId;
  storagePath: string;
};

/**
 * Best-effort deletion of previously stored output assets (the image/video
 * files written by {@link persistOutputFiles}). Only assets whose recorded
 * provider matches the currently configured storage provider are removed;
 * other providers' credentials are not available at runtime. Storage being
 * disabled (`none`) or misconfigured is treated as a no-op so callers never
 * fail because of cleanup.
 */
export async function deleteStoredAssets(
  references: readonly StoredAssetReference[],
): Promise<void> {
  if (references.length === 0) {
    return;
  }

  let provider: StorageProvider | null;

  try {
    provider = resolveOutputStorageProvider();
  } catch {
    return;
  }

  if (!provider) {
    return;
  }

  const keys = references
    .filter((reference) => reference.provider === provider.id)
    .map((reference) => reference.storagePath)
    .filter((path) => typeof path === 'string' && path.length > 0);

  if (keys.length === 0) {
    return;
  }

  await provider.remove(keys);
}

/**
 * Best-effort deletion of every stored output asset for a run - all of its
 * `runs/<runId>/<stepKey>/...` image, refine, video, and modify files - from
 * the configured storage provider, by object-key prefix. This does not depend
 * on per-step metadata, so it reclaims every output the run wrote. When the
 * provider is fronted by CloudFront, the run's `/runs/<runId>/*` cache is also
 * invalidated so deleted media stops being served from edge caches at once.
 * Storage being disabled (`none`) or misconfigured is a no-op so callers never
 * fail because of cleanup.
 */
export async function deleteRunStoredAssets(runId: string): Promise<void> {
  let provider: StorageProvider | null;

  try {
    provider = resolveOutputStorageProvider();
  } catch {
    return;
  }

  if (!provider) {
    return;
  }

  await provider.removeByPrefix(`runs/${runId}/`);
  await invalidateRunCdnCache(runId);
}

async function readOutputMedia(value: string) {
  const dataUrl = parseDataUrlOutputFile(value);

  if (dataUrl) {
    assertByteLimit(dataUrl.bytes.byteLength);
    return {
      bytes: Uint8Array.from(dataUrl.bytes),
      contentType: dataUrl.mediaType,
    };
  }

  const parsed = parseHttpsOutputUrl(value);
  const resolved = await lookupAllowedNetworkAddress(parsed.hostname);

  if (!resolved) {
    throw new Error('Output URL resolves to a blocked address.');
  }

  return downloadOutputMedia(parsed, resolved);
}

function parseHttpsOutputUrl(value: string) {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Output URL must be a data URL or HTTPS URL.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Output URL must use HTTPS.');
  }

  return parsed;
}

function downloadOutputMedia(parsed: URL, resolved: LookupAddress) {
  return new Promise<{ bytes: Uint8Array; contentType: string }>(
    (resolve, reject) => {
      const request = httpsRequest(
        parsed,
        {
          headers: {
            accept: 'image/*,video/*',
            'user-agent': OUTPUT_DOWNLOAD_USER_AGENT,
          },
          lookup: (_hostname, options, callback) => {
            if (typeof options === 'object' && options.all) {
              const allCallback = callback as unknown as (
                error: NodeJS.ErrnoException | null,
                addresses: LookupAddress[],
              ) => void;

              allCallback(null, [resolved]);
              return;
            }

            callback(null, resolved.address, resolved.family);
          },
          method: 'GET',
        },
        (response) => {
          void readOutputResponse(response, parsed.pathname)
            .then(resolve)
            .catch(reject);
        },
      );
      const timeout = setTimeout(() => {
        request.destroy(new Error('Output download timed out.'));
      }, OUTPUT_FETCH_TIMEOUT_MS);

      request.on('error', reject);
      request.on('close', () => clearTimeout(timeout));
      request.end();
    },
  );
}

async function readOutputResponse(response: IncomingMessage, pathname: string) {
  const status = response.statusCode ?? 0;

  if (status < 200 || status >= 300) {
    throw new Error(`Output download failed with status ${status}.`);
  }

  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of response) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    assertByteLimit(total);
    chunks.push(buffer);
  }

  const contentType = normalizeContentType(
    response.headers['content-type'],
    pathname,
  );

  return {
    bytes: Uint8Array.from(Buffer.concat(chunks)),
    contentType,
  };
}

function normalizeContentType(
  value: string | string[] | undefined,
  path: string,
) {
  const raw = Array.isArray(value) ? value[0] : value;
  const contentType = raw?.split(';')[0]?.trim().toLowerCase();

  if (contentType?.startsWith('image/') || contentType?.startsWith('video/')) {
    return contentType;
  }

  const extension = extname(path).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.mp4') return 'video/mp4';
  if (extension === '.webm') return 'video/webm';

  return 'application/octet-stream';
}

function extensionForContentType(contentType: string, source: string) {
  const normalized = contentType.toLowerCase();
  if (normalized === 'image/jpeg') return 'jpg';
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/gif') return 'gif';
  if (normalized === 'video/mp4') return 'mp4';
  if (normalized === 'video/webm') return 'webm';

  const extension = extname(source).replace(/^\./, '').toLowerCase();
  return extension || 'bin';
}

function assertByteLimit(byteLength: number) {
  if (byteLength > MAX_OUTPUT_STORAGE_BYTES) {
    throw new Error('Output media is larger than the app storage limit.');
  }
}

function safeStorageOriginalReference(value: string) {
  if (!value.trim().toLowerCase().startsWith('data:')) {
    return value;
  }

  const commaIndex = value.indexOf(',');
  const header = commaIndex >= 0 ? value.slice(0, commaIndex) : 'data:';
  return `${header},<inline ${value.length} chars>`;
}

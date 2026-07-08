import { Buffer } from 'node:buffer';

import type { JsonObject } from './types';

export type DataUrlOutputFile = {
  bytes: Buffer;
  mediaType: string;
};

const DEFAULT_DATA_URL_MEDIA_TYPE = 'text/plain;charset=US-ASCII';

export function serializeOutputFileReferences({
  files,
  runId,
  stepKey,
}: {
  files: readonly string[];
  runId: string;
  stepKey: string;
}) {
  return files.map((file, index) => {
    if (!isDataUrlOutputFile(file)) {
      return file;
    }

    return `/api/v1/chains/get/${runId}/outputs/${encodeURIComponent(stepKey)}/${index}`;
  });
}

export function outputFilesWithStorageUrls({
  files,
  providerMetadata,
}: {
  files: readonly string[];
  providerMetadata?: JsonObject | null;
}) {
  const storageAssets = readStorageAssets(providerMetadata);

  if (storageAssets.length === 0) {
    return [...files];
  }

  const hasIndexedAssets = storageAssets.some((asset) => asset.hasOutputIndex);

  return files.map((file, index) => {
    const asset = hasIndexedAssets
      ? storageAssets.find((candidate) => candidate.outputIndex === index)
      : storageAssets[index];

    return asset?.url ?? file;
  });
}

function readStorageAssets(providerMetadata: JsonObject | null | undefined) {
  const storage = providerMetadata?.app_storage;

  if (!isRecord(storage) || !Array.isArray(storage.assets)) {
    return [];
  }

  return storage.assets.flatMap((asset, fallbackIndex) => {
    if (!isRecord(asset) || typeof asset.url !== 'string') {
      return [];
    }

    const url = asset.url.trim();
    if (!isHttpsUrl(url)) {
      return [];
    }

    return [
      {
        hasOutputIndex: typeof asset.output_index === 'number',
        outputIndex:
          typeof asset.output_index === 'number'
            ? asset.output_index
            : fallbackIndex,
        url,
      },
    ];
  });
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isDataUrlOutputFile(value: string) {
  return splitDataUrl(value) !== null;
}

export function parseDataUrlOutputFile(
  value: string,
): DataUrlOutputFile | null {
  const parsed = splitDataUrl(value);

  if (!parsed) {
    return null;
  }

  const { data, isBase64, mediaType } = parsed;

  return {
    bytes: isBase64
      ? Buffer.from(data.replace(/\s/g, ''), 'base64')
      : Buffer.from(decodeURIComponent(data), 'utf8'),
    mediaType,
  };
}

export function createDataUrlOutputResponse(value: string) {
  const dataUrl = parseDataUrlOutputFile(value);

  if (!dataUrl) {
    return null;
  }

  const bytes = Uint8Array.from(dataUrl.bytes);

  return new Response(bytes, {
    headers: {
      'cache-control': 'no-store',
      'content-length': String(bytes.byteLength),
      'content-type': dataUrl.mediaType,
      'x-content-type-options': 'nosniff',
    },
  });
}

function splitDataUrl(value: string) {
  const trimmed = value.trim();

  if (!trimmed.toLowerCase().startsWith('data:')) {
    return null;
  }

  const dataStart = trimmed.indexOf(',');

  if (dataStart < 0) {
    return null;
  }

  const metadata = trimmed.slice('data:'.length, dataStart);
  const data = trimmed.slice(dataStart + 1);
  const metadataParts = metadata.split(';').filter(Boolean);
  const isBase64 = metadataParts.some(
    (part) => part.toLowerCase() === 'base64',
  );
  const mediaTypeParts = metadataParts.filter(
    (part) => part.toLowerCase() !== 'base64',
  );
  const mediaType =
    mediaTypeParts.length > 0
      ? mediaTypeParts.join(';')
      : DEFAULT_DATA_URL_MEDIA_TYPE;

  return { data, isBase64, mediaType };
}

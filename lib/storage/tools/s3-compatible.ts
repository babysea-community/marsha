import 'server-only';

import type { AppStorageProviderId, StorageProvider } from '../types';

export type S3CompatibleConfig = {
  accessKeyId: string;
  bucket: string;
  endpoint?: string | null;
  forcePathStyle?: boolean;
  publicBaseUrl: string;
  region: string;
  requestChecksumCalculation?: string;
  responseChecksumValidation?: string;
  secretAccessKey: string;
};

type S3ClientModule = {
  DeleteObjectsCommand: new (input: Record<string, unknown>) => unknown;
  ListObjectsV2Command: new (input: Record<string, unknown>) => unknown;
  PutObjectCommand: new (input: Record<string, unknown>) => unknown;
  S3Client: new (config: Record<string, unknown>) => {
    send(command: unknown): Promise<unknown>;
  };
};

// S3 DeleteObjects accepts at most 1000 keys per request.
const S3_DELETE_BATCH_SIZE = 1000;

export function createS3CompatibleStorageProvider({
  config,
  id,
  label,
}: {
  config: S3CompatibleConfig;
  id: AppStorageProviderId;
  label: string;
}): StorageProvider {
  async function createClient() {
    const sdk = await loadS3Client();
    const client = new sdk.S3Client({
      region: config.region,
      endpoint: config.endpoint ?? undefined,
      forcePathStyle: config.forcePathStyle ?? false,
      requestChecksumCalculation:
        config.requestChecksumCalculation ?? undefined,
      responseChecksumValidation:
        config.responseChecksumValidation ?? undefined,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });

    return { client, sdk };
  }

  return {
    id,
    label,
    async store(input) {
      const { client, sdk } = await createClient();

      await client.send(
        new sdk.PutObjectCommand({
          Bucket: config.bucket,
          Key: input.key,
          Body: input.data,
          ContentType: input.contentType,
        }),
      );

      return {
        publicUrl: buildPublicUrl(config.publicBaseUrl, input.key),
        storagePath: input.key,
      };
    },
    async remove(keys) {
      const unique = [...new Set(keys.filter((key) => key.length > 0))];

      if (unique.length === 0) {
        return;
      }

      const { client, sdk } = await createClient();

      for (
        let start = 0;
        start < unique.length;
        start += S3_DELETE_BATCH_SIZE
      ) {
        const batch = unique.slice(start, start + S3_DELETE_BATCH_SIZE);

        await client.send(
          new sdk.DeleteObjectsCommand({
            Bucket: config.bucket,
            Delete: {
              Objects: batch.map((Key) => ({ Key })),
              Quiet: true,
            },
          }),
        );
      }
    },
    async removeByPrefix(prefix) {
      if (!prefix) {
        return;
      }

      const { client, sdk } = await createClient();
      const keys: string[] = [];
      let continuationToken: string | undefined;

      do {
        const response = (await client.send(
          new sdk.ListObjectsV2Command({
            Bucket: config.bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
        )) as {
          Contents?: Array<{ Key?: string }>;
          IsTruncated?: boolean;
          NextContinuationToken?: string;
        };

        for (const object of response.Contents ?? []) {
          if (typeof object.Key === 'string' && object.Key.length > 0) {
            keys.push(object.Key);
          }
        }

        continuationToken = response.IsTruncated
          ? response.NextContinuationToken
          : undefined;
      } while (continuationToken);

      for (let start = 0; start < keys.length; start += S3_DELETE_BATCH_SIZE) {
        const batch = keys.slice(start, start + S3_DELETE_BATCH_SIZE);

        await client.send(
          new sdk.DeleteObjectsCommand({
            Bucket: config.bucket,
            Delete: {
              Objects: batch.map((Key) => ({ Key })),
              Quiet: true,
            },
          }),
        );
      }
    },
  };
}

function buildPublicUrl(baseUrl: string, key: string) {
  const base = baseUrl.replace(/\/+$/, '');
  const safeKey = key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  return `${base}/${safeKey}`;
}

async function loadS3Client(): Promise<S3ClientModule> {
  try {
    return (await import('@aws-sdk/client-s3')) as unknown as S3ClientModule;
  } catch {
    throw new Error(
      'S3-compatible storage is selected but @aws-sdk/client-s3 is not installed.',
    );
  }
}

import { afterEach, describe, expect, it, vi } from 'vitest';

import { outputFilesWithStorageUrls } from '@/lib/chains/output-files';
import {
  parseCloudflareR2Endpoint,
  parseCloudflareR2PublicBaseUrl,
} from '@/lib/storage/cloudflare-r2';
import { resolveAwsS3EndpointConfig } from '@/lib/storage/aws-s3';
import {
  persistOutputFiles,
  resolveOutputStorageProvider,
  type StorageProvider,
} from '@/lib/storage';

const s3EndpointInput = {
  bucket: 'app-media',
  region: 'us-east-1',
};

describe('output storage', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('ignores non-HTTPS storage metadata URLs', () => {
    expect(
      outputFilesWithStorageUrls({
        files: ['data:image/png;base64,aW1hZ2U='],
        providerMetadata: {
          app_storage: {
            assets: [
              {
                output_index: 0,
                url: 'javascript:alert(1)',
              },
            ],
          },
        },
      }),
    ).toEqual(['data:image/png;base64,aW1hZ2U=']);
  });

  it('uses AWS S3 bucket-host URLs as public URLs and strips the bucket for SDK writes', () => {
    expect(
      resolveAwsS3EndpointConfig({
        ...s3EndpointInput,
        endpointUrl: 'https://app-media.s3.us-east-1.amazonaws.com',
      }),
    ).toEqual({
      clientEndpoint: 'https://s3.us-east-1.amazonaws.com',
      publicBaseUrl: 'https://app-media.s3.us-east-1.amazonaws.com',
    });
  });

  it('supports AWS S3 path-style bucket URLs', () => {
    expect(
      resolveAwsS3EndpointConfig({
        ...s3EndpointInput,
        endpointUrl: 'https://s3.us-east-1.amazonaws.com/app-media',
      }),
    ).toEqual({
      clientEndpoint: 'https://s3.us-east-1.amazonaws.com',
      publicBaseUrl: 'https://s3.us-east-1.amazonaws.com/app-media',
    });
  });

  it('derives an AWS S3 bucket public URL from a service endpoint', () => {
    expect(
      resolveAwsS3EndpointConfig({
        ...s3EndpointInput,
        endpointUrl: 'https://s3.us-east-1.amazonaws.com',
      }),
    ).toEqual({
      clientEndpoint: 'https://s3.us-east-1.amazonaws.com',
      publicBaseUrl: 'https://app-media.s3.us-east-1.amazonaws.com',
    });
  });

  it('uses custom AWS S3 endpoint URLs as public URLs and regional S3 for SDK writes', () => {
    expect(
      resolveAwsS3EndpointConfig({
        ...s3EndpointInput,
        endpointUrl: 'https://media.example.com',
      }),
    ).toEqual({
      clientEndpoint: 'https://s3.us-east-1.amazonaws.com',
      publicBaseUrl: 'https://media.example.com',
    });
  });

  it('rejects mismatched AWS S3 endpoint bucket paths', () => {
    expect(() =>
      resolveAwsS3EndpointConfig({
        ...s3EndpointInput,
        endpointUrl: 'https://s3.us-east-1.amazonaws.com/other-bucket',
      }),
    ).toThrow('AWS_S3_ENDPOINT_URL bucket path must match AWS_S3_BUCKET_NAME.');
  });

  it('accepts Cloudflare R2 S3 API endpoints and strips bucket paths for SDK writes', () => {
    expect(
      parseCloudflareR2Endpoint({
        accountId: 'abc123',
        bucket: 'app-media',
        endpointUrl: 'https://abc123.r2.cloudflarestorage.com/app-media',
      }),
    ).toEqual({
      s3Endpoint: 'https://abc123.r2.cloudflarestorage.com',
    });
  });

  it('rejects Cloudflare R2 custom domains that point at the S3 API endpoint', () => {
    expect(() =>
      parseCloudflareR2PublicBaseUrl('https://abc123.r2.cloudflarestorage.com'),
    ).toThrow('CLOUDFLARE_R2_CUSTOM_DOMAIN_URL must be an R2 public domain');
  });

  it('resolves MinIO from S3-compatible environment values', () => {
    vi.stubEnv('APP_STORAGE_PROVIDER', 'minio');
    vi.stubEnv('MINIO_ENDPOINT_URL', 'https://minio.example.com');
    vi.stubEnv('MINIO_ACCESS_KEY_ID', 'minio_access_key');
    vi.stubEnv('MINIO_SECRET_ACCESS_KEY', 'minio_secret_key');
    vi.stubEnv('MINIO_BUCKET_NAME', 'app-media');

    expect(resolveOutputStorageProvider()).toMatchObject({
      id: 'minio',
      label: 'minio · app-media',
    });
  });

  it('resolves Scaleway Object Storage from S3-compatible environment values', () => {
    vi.stubEnv('APP_STORAGE_PROVIDER', 'scaleway-object-storage');
    vi.stubEnv('SCALEWAY_OBJECT_STORAGE_REGION', 'fr-par');
    vi.stubEnv('SCALEWAY_OBJECT_STORAGE_ACCESS_KEY_ID', 'scw_access_key');
    vi.stubEnv('SCALEWAY_OBJECT_STORAGE_SECRET_ACCESS_KEY', 'scw_secret_key');
    vi.stubEnv('SCALEWAY_OBJECT_STORAGE_BUCKET_NAME', 'app-media');

    expect(resolveOutputStorageProvider()).toMatchObject({
      id: 'scaleway-object-storage',
      label: 'scaleway-object-storage · app-media',
    });
  });

  it('resolves Spaces Object Storage from S3-compatible environment values', () => {
    vi.stubEnv('APP_STORAGE_PROVIDER', 'spaces-object-storage');
    vi.stubEnv('SPACES_REGION', 'nyc3');
    vi.stubEnv('SPACES_ACCESS_KEY_ID', 'spaces_access_key');
    vi.stubEnv('SPACES_SECRET_ACCESS_KEY', 'spaces_secret_key');
    vi.stubEnv('SPACES_BUCKET_NAME', 'app-media');

    expect(resolveOutputStorageProvider()).toMatchObject({
      id: 'spaces-object-storage',
      label: 'spaces-object-storage · app-media',
    });
  });

  it('resolves Hugging Face Storage Buckets from S3-compatible environment values', () => {
    vi.stubEnv('APP_STORAGE_PROVIDER', 'huggingface-storage-buckets');
    vi.stubEnv('HUGGINGFACE_STORAGE_NAMESPACE', 'babysea');
    vi.stubEnv('HUGGINGFACE_STORAGE_ACCESS_KEY_ID', 'HFAK_example');
    vi.stubEnv('HUGGINGFACE_STORAGE_SECRET_ACCESS_KEY', 'hf_secret_key');
    vi.stubEnv('HUGGINGFACE_STORAGE_BUCKET_NAME', 'app-media');

    expect(resolveOutputStorageProvider()).toMatchObject({
      id: 'huggingface-storage-buckets',
      label: 'huggingface-storage-buckets · babysea/app-media',
    });
  });

  it('stores data URL outputs through the selected provider', async () => {
    const writes: Parameters<StorageProvider['store']>[0][] = [];
    const provider: StorageProvider = {
      id: 'vercel-blob',
      label: 'test blob',
      store: async (input) => {
        writes.push(input);

        return {
          publicUrl: `https://blob.example.com/${input.key}`,
          storagePath: input.key,
        };
      },
      remove: async () => undefined,
      removeByPrefix: async () => undefined,
    };

    const result = await persistOutputFiles({
      outputFiles: ['data:image/png;base64,aW1hZ2U='],
      provider,
      runId: 'run_123',
      stepKey: 'image',
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      contentType: 'image/png',
      key: 'runs/run_123/image/output-0.png',
    });
    expect(Buffer.from(writes[0]!.data).toString('utf8')).toBe('image');
    expect(result.outputFiles).toEqual([
      'https://blob.example.com/runs/run_123/image/output-0.png',
    ]);
    expect(result.storageMetadata).toMatchObject({
      provider: 'vercel-blob',
      assets: [
        {
          byte_length: 5,
          content_type: 'image/png',
          output_index: 0,
          provider: 'vercel-blob',
          storage_path: 'runs/run_123/image/output-0.png',
          url: 'https://blob.example.com/runs/run_123/image/output-0.png',
        },
      ],
    });
    expect(result.storageMetadata?.assets[0]?.original_url).toContain(
      '<inline',
    );
  });

  it('keeps original outputs when optional storage fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const provider: StorageProvider = {
      id: 'aws-s3',
      label: 'test s3',
      store: async () => {
        throw new Error('AccessDenied');
      },
      remove: async () => undefined,
      removeByPrefix: async () => undefined,
    };
    const output = 'data:image/jpeg;base64,aW1hZ2U=';

    const result = await persistOutputFiles({
      outputFiles: [output],
      provider,
      runId: 'run_123',
      stepKey: 'image',
    });

    expect(result.outputFiles).toEqual([output]);
    expect(result.storageMetadata).toBeNull();
    warn.mockRestore();
  });
});

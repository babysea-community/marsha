import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  invalidateRunCdnCache,
  runInvalidationPath,
  selectCloudFrontDistributionId,
} from '@/lib/storage/tools/cloudfront';

const cloudfront = vi.hoisted(() => {
  const state = {
    distributions: [] as Array<Record<string, unknown>>,
    invalidations: [] as Array<Record<string, unknown>>,
    listCalls: 0,
  };

  class ListDistributionsCommand {
    constructor(public readonly input: Record<string, unknown>) {}
  }

  class CreateInvalidationCommand {
    constructor(public readonly input: Record<string, unknown>) {}
  }

  class CloudFrontClient {
    constructor(public readonly config: Record<string, unknown>) {}

    async send(command: unknown) {
      if (command instanceof ListDistributionsCommand) {
        state.listCalls += 1;
        return {
          DistributionList: {
            Items: state.distributions,
            IsTruncated: false,
          },
        };
      }

      if (command instanceof CreateInvalidationCommand) {
        state.invalidations.push(command.input);
        return {};
      }

      throw new Error('unexpected CloudFront command');
    }
  }

  return {
    state,
    CloudFrontClient,
    CreateInvalidationCommand,
    ListDistributionsCommand,
  };
});

vi.mock('@aws-sdk/client-cloudfront', () => ({
  CloudFrontClient: cloudfront.CloudFrontClient,
  CreateInvalidationCommand: cloudfront.CreateInvalidationCommand,
  ListDistributionsCommand: cloudfront.ListDistributionsCommand,
}));

const ENV_KEYS = [
  'APP_STORAGE_PROVIDER',
  'AWS_S3_REGION',
  'AWS_S3_BUCKET_NAME',
  'AWS_S3_ENDPOINT_URL',
  'AWS_S3_ACCESS_KEY_ID',
  'AWS_S3_SECRET_ACCESS_KEY',
] as const;

const originalEnv = new Map(
  ENV_KEYS.map((key) => [key, process.env[key]] as const),
);

function setAwsS3Env(endpointUrl: string) {
  process.env.APP_STORAGE_PROVIDER = 'aws-s3';
  process.env.AWS_S3_REGION = 'us-east-1';
  process.env.AWS_S3_BUCKET_NAME = 'app-media';
  process.env.AWS_S3_ENDPOINT_URL = endpointUrl;
  process.env.AWS_S3_ACCESS_KEY_ID = 'AKIAEXAMPLE';
  process.env.AWS_S3_SECRET_ACCESS_KEY = 'secret-example';
}

afterEach(() => {
  cloudfront.state.distributions = [];
  cloudfront.state.invalidations = [];
  cloudfront.state.listCalls = 0;

  for (const key of ENV_KEYS) {
    const original = originalEnv.get(key);

    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
});

describe('runInvalidationPath', () => {
  it('builds a run wildcard path for a root public base URL', () => {
    expect(runInvalidationPath('https://cdn.example.com', 'run-123')).toBe(
      '/runs/run-123/*',
    );
  });

  it('preserves a base-path component of the public base URL', () => {
    expect(
      runInvalidationPath('https://cdn.example.com/media/', 'run-123'),
    ).toBe('/media/runs/run-123/*');
  });
});

describe('selectCloudFrontDistributionId', () => {
  it('matches a distribution by its assigned domain name', () => {
    expect(
      selectCloudFrontDistributionId(
        [
          { Id: 'EAAA', DomainName: 'other.cloudfront.net' },
          { Id: 'EBBB', DomainName: 'media.cloudfront.net' },
        ],
        'media.cloudfront.net',
      ),
    ).toBe('EBBB');
  });

  it('matches a custom domain against a distribution alias (case-insensitive)', () => {
    expect(
      selectCloudFrontDistributionId(
        [
          {
            Id: 'ECCC',
            DomainName: 'd123.cloudfront.net',
            Aliases: { Items: ['Media.Example.Com'] },
          },
        ],
        'media.example.com',
      ),
    ).toBe('ECCC');
  });

  it('returns null when no distribution matches the host', () => {
    expect(
      selectCloudFrontDistributionId(
        [{ Id: 'EDDD', DomainName: 'd123.cloudfront.net' }],
        'media.example.com',
      ),
    ).toBeNull();
  });

  it('skips distributions without an id', () => {
    expect(
      selectCloudFrontDistributionId(
        [{ DomainName: 'media.example.com' }],
        'media.example.com',
      ),
    ).toBeNull();
  });
});

describe('invalidateRunCdnCache', () => {
  it('invalidates the run wildcard path on the matching CloudFront distribution', async () => {
    setAwsS3Env('https://d1example.cloudfront.net');
    cloudfront.state.distributions = [
      { Id: 'E123ABC', DomainName: 'd1example.cloudfront.net' },
    ];

    await invalidateRunCdnCache('run-abc');

    expect(cloudfront.state.invalidations).toHaveLength(1);
    expect(cloudfront.state.invalidations[0]).toMatchObject({
      DistributionId: 'E123ABC',
      InvalidationBatch: {
        Paths: { Items: ['/runs/run-abc/*'], Quantity: 1 },
      },
    });
  });

  it('resolves a custom media domain via a distribution alias', async () => {
    setAwsS3Env('https://media.example.test');
    cloudfront.state.distributions = [
      {
        Id: 'E999XYZ',
        DomainName: 'dcustom.cloudfront.net',
        Aliases: { Items: ['media.example.test'] },
      },
    ];

    await invalidateRunCdnCache('run-xyz');

    expect(cloudfront.state.invalidations).toHaveLength(1);
    expect(cloudfront.state.invalidations[0]).toMatchObject({
      DistributionId: 'E999XYZ',
      InvalidationBatch: { Paths: { Items: ['/runs/run-xyz/*'] } },
    });
  });

  it('does nothing when storage is not AWS S3', async () => {
    process.env.APP_STORAGE_PROVIDER = 'vercel-blob';

    await invalidateRunCdnCache('run-skip');

    expect(cloudfront.state.listCalls).toBe(0);
    expect(cloudfront.state.invalidations).toHaveLength(0);
  });

  it('skips public URLs that point straight at the S3 REST API', async () => {
    setAwsS3Env('https://app-media.s3.us-east-1.amazonaws.com');

    await invalidateRunCdnCache('run-direct');

    expect(cloudfront.state.listCalls).toBe(0);
    expect(cloudfront.state.invalidations).toHaveLength(0);
  });
});

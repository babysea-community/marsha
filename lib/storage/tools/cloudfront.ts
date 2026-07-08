import 'server-only';

import { resolveAwsS3EndpointConfig } from '../aws-s3';

type CloudFrontClient = {
  send(command: unknown): Promise<unknown>;
};

type CloudFrontClientModule = {
  CloudFrontClient: new (config: Record<string, unknown>) => CloudFrontClient;
  CreateInvalidationCommand: new (input: Record<string, unknown>) => unknown;
  ListDistributionsCommand: new (input: Record<string, unknown>) => unknown;
};

type CloudFrontDistributionSummary = {
  Aliases?: { Items?: string[] };
  DomainName?: string;
  Id?: string;
};

type InvalidationTarget = {
  accessKeyId: string;
  host: string;
  publicBaseUrl: string;
  region: string;
  secretAccessKey: string;
};

// CloudFront distribution-id lookups are memoized per public host for the life
// of the server process: ListDistributions is comparatively expensive and the
// domain behind AWS_S3_ENDPOINT_URL is stable at runtime. A resolved value
// (the id, or `null` when no distribution matches) is cached so repeated
// deletes never re-list; a thrown lookup is removed from the cache so a
// transient error can be retried on the next delete.
const distributionIdByHost = new Map<string, Promise<string | null>>();

/**
 * Best-effort CloudFront cache invalidation for every object a run served
 * under `/runs/<runId>/*`. Called right after the run's stored image/video
 * files are removed (for example when an owner deletes a canvas card) so the
 * deleted media stops being served from edge caches immediately instead of
 * lingering until its TTL expires.
 *
 * No-ops unless AWS S3 storage is configured behind a CloudFront (or custom)
 * domain. A public URL that points straight at the S3 REST API, a disabled
 * provider, missing credentials, the SDK not being installed, or any AWS error
 * are all swallowed so cleanup never blocks the delete the owner already
 * requested.
 */
export async function invalidateRunCdnCache(runId: string): Promise<void> {
  let target: InvalidationTarget | null;

  try {
    target = resolveInvalidationTarget();
  } catch {
    return;
  }

  if (!target) {
    return;
  }

  try {
    const sdk = await loadCloudFrontClient();
    const client = new sdk.CloudFrontClient({
      region: target.region,
      credentials: {
        accessKeyId: target.accessKeyId,
        secretAccessKey: target.secretAccessKey,
      },
    });

    const distributionId = await resolveDistributionId(
      client,
      sdk,
      target.host,
    );

    if (!distributionId) {
      return;
    }

    await client.send(
      new sdk.CreateInvalidationCommand({
        DistributionId: distributionId,
        InvalidationBatch: {
          CallerReference: `marsha-run-${runId}-${Date.now()}`,
          Paths: {
            Items: [runInvalidationPath(target.publicBaseUrl, runId)],
            Quantity: 1,
          },
        },
      }),
    );
  } catch (error) {
    console.warn('[marsha] CloudFront invalidation failed', {
      error: error instanceof Error ? error.message : String(error),
      runId,
    });
  }
}

/**
 * Builds the CloudFront invalidation path covering all of a run's outputs from
 * the storage provider's public base URL, mirroring the `runs/<runId>/...`
 * object keys and preserving any base-path component of the public URL.
 * Exported for tests.
 */
export function runInvalidationPath(
  publicBaseUrl: string,
  runId: string,
): string {
  const basePath = new URL(publicBaseUrl).pathname.replace(/\/+$/, '');
  return `${basePath}/runs/${runId}/*`;
}

/**
 * Picks the CloudFront distribution whose assigned domain, or one of whose
 * alternate domain names (CNAMEs), matches the public media host. Exported for
 * tests.
 */
export function selectCloudFrontDistributionId(
  distributions: readonly CloudFrontDistributionSummary[],
  host: string,
): string | null {
  const normalizedHost = host.toLowerCase();

  for (const distribution of distributions) {
    if (typeof distribution.Id !== 'string' || distribution.Id.length === 0) {
      continue;
    }

    const domainName = distribution.DomainName?.toLowerCase();
    const aliases = (distribution.Aliases?.Items ?? []).map((alias) =>
      alias.toLowerCase(),
    );

    if (domainName === normalizedHost || aliases.includes(normalizedHost)) {
      return distribution.Id;
    }
  }

  return null;
}

function resolveInvalidationTarget(): InvalidationTarget | null {
  const provider = process.env.APP_STORAGE_PROVIDER?.trim() || 'none';

  if (provider !== 'aws-s3') {
    return null;
  }

  const region = process.env.AWS_S3_REGION?.trim();
  const bucket = process.env.AWS_S3_BUCKET_NAME?.trim();
  const endpointUrl = process.env.AWS_S3_ENDPOINT_URL?.trim();
  const accessKeyId = process.env.AWS_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_S3_SECRET_ACCESS_KEY?.trim();

  if (!region || !bucket || !endpointUrl || !accessKeyId || !secretAccessKey) {
    return null;
  }

  const { publicBaseUrl } = resolveAwsS3EndpointConfig({
    bucket,
    endpointUrl,
    region,
  });
  const host = new URL(publicBaseUrl).hostname.toLowerCase();

  // A public URL that points straight at the S3 REST API has no CloudFront
  // distribution to purge, so skip it (and avoid a needless ListDistributions
  // call and the IAM permission it would require).
  if (isAwsS3PublicHost(host)) {
    return null;
  }

  return { accessKeyId, host, publicBaseUrl, region, secretAccessKey };
}

function isAwsS3PublicHost(host: string): boolean {
  return /(^|\.)s3([.-][a-z0-9-]+)?\.amazonaws\.com$/.test(host);
}

async function resolveDistributionId(
  client: CloudFrontClient,
  sdk: CloudFrontClientModule,
  host: string,
): Promise<string | null> {
  const cached = distributionIdByHost.get(host);

  if (cached) {
    return cached;
  }

  const lookup = listDistributionId(client, sdk, host);
  distributionIdByHost.set(host, lookup);

  try {
    return await lookup;
  } catch (error) {
    distributionIdByHost.delete(host);
    throw error;
  }
}

async function listDistributionId(
  client: CloudFrontClient,
  sdk: CloudFrontClientModule,
  host: string,
): Promise<string | null> {
  let marker: string | undefined;

  do {
    const response = (await client.send(
      new sdk.ListDistributionsCommand(marker ? { Marker: marker } : {}),
    )) as {
      DistributionList?: {
        IsTruncated?: boolean;
        Items?: CloudFrontDistributionSummary[];
        NextMarker?: string;
      };
    };

    const list = response.DistributionList;
    const match = selectCloudFrontDistributionId(list?.Items ?? [], host);

    if (match) {
      return match;
    }

    marker = list?.IsTruncated ? list.NextMarker : undefined;
  } while (marker);

  return null;
}

async function loadCloudFrontClient(): Promise<CloudFrontClientModule> {
  try {
    return (await import('@aws-sdk/client-cloudfront')) as unknown as CloudFrontClientModule;
  } catch {
    throw new Error(
      'CloudFront invalidation is configured but @aws-sdk/client-cloudfront is not installed.',
    );
  }
}

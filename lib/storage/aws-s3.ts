import 'server-only';

import { createS3CompatibleStorageProvider } from './tools/s3-compatible';
import type { StorageProvider } from './types';

export function createAwsS3(): StorageProvider {
  const region = required(process.env.AWS_S3_REGION, 'AWS_S3_REGION');
  const bucket = required(process.env.AWS_S3_BUCKET_NAME, 'AWS_S3_BUCKET_NAME');
  const endpointConfig = resolveAwsS3EndpointConfig({
    bucket,
    endpointUrl: required(
      process.env.AWS_S3_ENDPOINT_URL,
      'AWS_S3_ENDPOINT_URL',
    ),
    region,
  });

  return createS3CompatibleStorageProvider({
    id: 'aws-s3',
    label: `aws-s3 · ${bucket}`,
    config: {
      accessKeyId: required(
        process.env.AWS_S3_ACCESS_KEY_ID,
        'AWS_S3_ACCESS_KEY_ID',
      ),
      bucket,
      endpoint: endpointConfig.clientEndpoint,
      publicBaseUrl: endpointConfig.publicBaseUrl,
      region,
      secretAccessKey: required(
        process.env.AWS_S3_SECRET_ACCESS_KEY,
        'AWS_S3_SECRET_ACCESS_KEY',
      ),
    },
  });
}

export function resolveAwsS3EndpointConfig(input: {
  bucket: string;
  endpointUrl: string;
  region: string;
}) {
  const { bucket, endpointUrl, region } = input;
  let url: URL;

  try {
    url = new URL(endpointUrl);
  } catch {
    throw new Error('AWS_S3_ENDPOINT_URL must be a valid URL.');
  }

  if (url.protocol !== 'https:') {
    throw new Error('AWS_S3_ENDPOINT_URL must use HTTPS.');
  }

  if (url.username || url.password) {
    throw new Error('AWS_S3_ENDPOINT_URL must not include credentials.');
  }

  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';

  const hostname = url.hostname.toLowerCase();
  const bucketHostSuffix = awsS3BucketHostSuffix(hostname, bucket);

  if (bucketHostSuffix) {
    if (url.pathname && url.pathname !== '/') {
      throw new Error(
        'AWS_S3_ENDPOINT_URL bucket-host URL must not include a path.',
      );
    }

    return {
      clientEndpoint: `${url.protocol}//${bucketHostSuffix}`,
      publicBaseUrl: url.toString().replace(/\/+$/, ''),
    };
  }

  if (isAwsS3ServiceHost(hostname)) {
    const endpointBucket = bucketFromEndpointPath(url.pathname);
    const clientEndpoint = `${url.protocol}//${url.host}`;

    if (endpointBucket && endpointBucket !== bucket) {
      throw new Error(
        'AWS_S3_ENDPOINT_URL bucket path must match AWS_S3_BUCKET_NAME.',
      );
    }

    return {
      clientEndpoint,
      publicBaseUrl: endpointBucket
        ? `${clientEndpoint}/${encodeURIComponent(endpointBucket)}`
        : `${url.protocol}//${bucket}.${regionalAwsS3ServiceHost(region)}`,
    };
  }

  return {
    clientEndpoint: `${url.protocol}//${regionalAwsS3ServiceHost(region)}`,
    publicBaseUrl: url.toString().replace(/\/+$/, ''),
  };
}

function awsS3BucketHostSuffix(hostname: string, bucket: string) {
  const normalizedBucket = bucket.toLowerCase();

  if (!hostname.startsWith(`${normalizedBucket}.`)) {
    return null;
  }

  const suffix = hostname.slice(normalizedBucket.length + 1);

  return isAwsS3ServiceHost(suffix) ? suffix : null;
}

function isAwsS3ServiceHost(hostname: string) {
  return (
    hostname === 's3.amazonaws.com' ||
    /^s3[.-][a-z0-9-]+\.amazonaws\.com$/.test(hostname)
  );
}

function regionalAwsS3ServiceHost(region: string) {
  return `s3.${region}.amazonaws.com`;
}

function bucketFromEndpointPath(pathname: string) {
  const trimmed = pathname.replace(/^\/+|\/+$/g, '');

  if (!trimmed) {
    return null;
  }

  if (trimmed.includes('/')) {
    throw new Error(
      'AWS_S3_ENDPOINT_URL can include only the bucket path, for example https://s3.us-east-1.amazonaws.com/marsha.',
    );
  }

  return decodeURIComponent(trimmed);
}

function required(value: string | undefined, name: string) {
  const trimmed = optional(value);

  if (!trimmed) {
    throw new Error(`${name} is required when APP_STORAGE_PROVIDER=aws-s3.`);
  }

  return trimmed;
}

function optional(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

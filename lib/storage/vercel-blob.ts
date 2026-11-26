import 'server-only';

import type { StorageProvider } from './types';

type VercelBlobModule = {
  del(
    urlOrPathname: string | string[],
    options: { token: string },
  ): Promise<void>;
  list(options: {
    cursor?: string;
    limit?: number;
    prefix?: string;
    token: string;
  }): Promise<{
    blobs: Array<{ pathname: string; url: string }>;
    cursor?: string;
    hasMore: boolean;
  }>;
  put(
    pathname: string,
    body: Uint8Array | Buffer | Blob,
    options: {
      access: 'public';
      addRandomSuffix?: boolean;
      allowOverwrite?: boolean;
      contentType: string;
      token: string;
    },
  ): Promise<{ url: string }>;
};

export function createVercelBlob(): StorageProvider {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();

  if (!token) {
    throw new Error(
      'BLOB_READ_WRITE_TOKEN is required when APP_STORAGE_PROVIDER=vercel-blob.',
    );
  }

  return {
    id: 'vercel-blob',
    label: 'vercel-blob',
    async store(input) {
      const blob = await loadVercelBlob();
      const result = await blob.put(input.key, input.data, {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: input.contentType,
        token,
      });

      return { publicUrl: result.url, storagePath: input.key };
    },
    async remove(keys) {
      const unique = [...new Set(keys.filter((key) => key.length > 0))];

      if (unique.length === 0) {
        return;
      }

      const blob = await loadVercelBlob();
      // `del` accepts blob pathnames (our storagePath) as well as full URLs.
      await blob.del(unique, { token });
    },
    async removeByPrefix(prefix) {
      if (!prefix) {
        return;
      }

      const blob = await loadVercelBlob();
      const urls: string[] = [];
      let cursor: string | undefined;

      do {
        const page = await blob.list({ prefix, token, cursor });
        for (const item of page.blobs) {
          if (item.url) {
            urls.push(item.url);
          }
        }
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);

      if (urls.length === 0) {
        return;
      }

      await blob.del(urls, { token });
    },
  };
}

async function loadVercelBlob(): Promise<VercelBlobModule> {
  try {
    return (await import('@vercel/blob')) as unknown as VercelBlobModule;
  } catch {
    throw new Error(
      'vercel-blob storage is selected but @vercel/blob is not installed.',
    );
  }
}

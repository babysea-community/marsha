export type AppStorageProviderId =
  | 'alibaba-cloud-oss'
  | 'aws-s3'
  | 'backblaze-b2'
  | 'cloudflare-r2'
  | 'huggingface-storage-buckets'
  | 'minio'
  | 'scaleway-object-storage'
  | 'spaces-object-storage'
  | 'vercel-blob';

export type StoreInput = {
  contentType: string;
  data: Uint8Array;
  key: string;
};

export type StoreResult = {
  publicUrl: string | null;
  storagePath: string;
};

export type StorageProvider = {
  readonly id: AppStorageProviderId;
  readonly label: string;
  store(input: StoreInput): Promise<StoreResult>;
  /**
   * Permanently delete stored objects by their storage path (an S3 object key
   * or a Vercel Blob pathname). Best-effort: already-missing objects are
   * ignored. Used when an owner deletes a canvas to reclaim its image/video
   * files while keeping the database history rows.
   */
  remove(keys: string[]): Promise<void>;
  /**
   * Permanently delete every stored object whose key/pathname starts with the
   * given prefix (for example `runs/<runId>/` to reclaim all of a run's image,
   * refine, video, and modify outputs). Best-effort; missing objects and a
   * disabled/misconfigured provider are ignored.
   */
  removeByPrefix(prefix: string): Promise<void>;
};

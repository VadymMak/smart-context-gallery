import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { r2, BUCKET } from './r2';

export interface ImageMetadata {
  key: string;
  filename: string;
  folder: string;
  size: number;
  uploadedAt: string;
  description: string;
  tags: string[];
  category: string;
  style: string;
  colors: string[];
  project?: string;
  fileType?: string;
}

export interface MetadataStore {
  version: number;
  images: Record<string, ImageMetadata>;
  projects: string[];
}

const METADATA_KEY = '_metadata.json';

export async function loadMetadata(): Promise<MetadataStore> {
  try {
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: METADATA_KEY });
    const response = await r2.send(command);
    const body = await response.Body?.transformToString();
    if (!body) return createEmptyStore();
    return JSON.parse(body) as MetadataStore;
  } catch (error: unknown) {
    const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      return createEmptyStore();
    }
    throw error;
  }
}

export async function saveMetadata(store: MetadataStore): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: METADATA_KEY,
    Body: JSON.stringify(store, null, 2),
    ContentType: 'application/json',
  });
  await r2.send(command);
}

function createEmptyStore(): MetadataStore {
  return { version: 1, images: {}, projects: [] };
}

// R2 has no conditional-put (If-Match), so we use a read-modify-write retry
// loop. Each attempt re-reads the latest state before writing, then verifies
// the entry survived a potential concurrent overwrite before returning.
const MAX_RETRIES = 5;
const jitter = () => new Promise<void>((r) => setTimeout(r, 40 + Math.random() * 80));

export async function addImageMetadata(meta: ImageMetadata): Promise<void> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const store = await loadMetadata();
    store.images[meta.key] = meta;
    await saveMetadata(store);

    if (attempt < MAX_RETRIES - 1) {
      await jitter();
      const verify = await loadMetadata();
      if (verify.images[meta.key]) return;
      console.warn(`[metadata] Write conflict (attempt ${attempt + 1}/${MAX_RETRIES}), retrying…`);
    }
  }
}

export async function removeImageMetadata(key: string): Promise<void> {
  // Delete is idempotent — a single attempt is enough; verify not needed.
  const store = await loadMetadata();
  delete store.images[key];
  await saveMetadata(store);
}

export async function searchImages(query: string, userId?: string): Promise<ImageMetadata[]> {
  const store = await loadMetadata();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

  return Object.values(store.images).filter((img) => {
    if (userId && !img.key.startsWith(`${userId}/`)) return false;

    const searchable = [
      img.description,
      ...img.tags,
      img.category,
      img.style,
      ...img.colors,
      img.folder,
      img.project || '',
      img.filename,
      img.fileType || '',
    ].join(' ').toLowerCase();

    return terms.every((term) => searchable.includes(term));
  });
}

export async function getProjectImages(project: string, userId?: string): Promise<ImageMetadata[]> {
  const store = await loadMetadata();
  return Object.values(store.images).filter((img) => {
    if (userId && !img.key.startsWith(`${userId}/`)) return false;
    return img.project === project;
  });
}

export async function assignProject(keys: string[], project: string): Promise<void> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const store = await loadMetadata();
    for (const key of keys) {
      if (store.images[key]) store.images[key].project = project;
    }
    if (!store.projects.includes(project)) store.projects.push(project);
    await saveMetadata(store);

    if (attempt < MAX_RETRIES - 1) {
      await jitter();
      const verify = await loadMetadata();
      const allSet = keys.every(
        (k) => !verify.images[k] || verify.images[k].project === project
      );
      if (allSet) return;
      console.warn(`[metadata] assignProject conflict (attempt ${attempt + 1}/${MAX_RETRIES}), retrying…`);
    }
  }
}

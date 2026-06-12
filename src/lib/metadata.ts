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

export async function addImageMetadata(meta: ImageMetadata): Promise<void> {
  const store = await loadMetadata();
  store.images[meta.key] = meta;
  await saveMetadata(store);
}

export async function removeImageMetadata(key: string): Promise<void> {
  const store = await loadMetadata();
  delete store.images[key];
  await saveMetadata(store);
}

export async function searchImages(query: string): Promise<ImageMetadata[]> {
  const store = await loadMetadata();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

  return Object.values(store.images).filter((img) => {
    const searchable = [
      img.description,
      ...img.tags,
      img.category,
      img.style,
      ...img.colors,
      img.folder,
      img.project || '',
      img.filename,
    ].join(' ').toLowerCase();

    return terms.every((term) => searchable.includes(term));
  });
}

export async function getProjectImages(project: string): Promise<ImageMetadata[]> {
  const store = await loadMetadata();
  return Object.values(store.images).filter((img) => img.project === project);
}

export async function assignProject(keys: string[], project: string): Promise<void> {
  const store = await loadMetadata();
  for (const key of keys) {
    if (store.images[key]) {
      store.images[key].project = project;
    }
  }
  if (!store.projects.includes(project)) {
    store.projects.push(project);
  }
  await saveMetadata(store);
}

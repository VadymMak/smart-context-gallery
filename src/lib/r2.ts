import { S3Client, ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

export const BUCKET = process.env.R2_BUCKET_NAME!;

export interface GalleryImage {
  key: string;
  url: string;
  size: number;
  lastModified: Date;
  folder: string;
  filename: string;
}

export async function listImages(folder?: string, userId?: string): Promise<GalleryImage[]> {
  let prefix = '';
  if (userId) {
    prefix = folder ? `${userId}/${folder}/` : `${userId}/`;
  } else if (folder) {
    prefix = `${folder}/`;
  }

  const command = new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix });
  const response = await r2.send(command);
  const objects = response.Contents || [];

  const images: GalleryImage[] = await Promise.all(
    objects
      .filter((obj) => {
        if (!obj.Key || obj.Key.endsWith('/')) return false;
        const filename = obj.Key.split('/').pop() || '';
        // Skip system/marker files
        if (filename.startsWith('_')) return false;
        if (obj.Key.startsWith('_')) return false;
        return true;
      })
      .map(async (obj) => {
        const url = await getSignedUrl(
          r2,
          new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key! }),
          { expiresIn: 3600 }
        );
        const parts = obj.Key!.split('/');
        const filename = parts[parts.length - 1];
        // userId/folder/sub/file.jpg → folder = 'folder/sub'
        // userId/file.jpg           → folder = 'uncategorized'
        const folder = userId
          ? (parts.length > 2 ? parts.slice(1, -1).join('/') : 'uncategorized')
          : (parts.length > 1 ? parts.slice(0, -1).join('/') : 'uncategorized');

        return {
          key: obj.Key!,
          url,
          size: obj.Size || 0,
          lastModified: obj.LastModified || new Date(),
          folder,
          filename,
        };
      })
  );

  return images.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
}

export async function uploadImage(
  file: Buffer,
  filename: string,
  contentType: string,
  folder: string = 'uncategorized',
  userId?: string
): Promise<string> {
  if (!userId) throw new Error('userId is required for upload');

  const safe = filename.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9.\-_]/g, '');
  let key = `${userId}/${folder}/${Date.now()}-${safe}`;

  // Safety guard: key must always start with user_ prefix
  if (!key.startsWith('user_')) {
    console.warn(`[r2] Fixed missing user_ prefix: ${key}`);
    key = `user_${key}`;
  }

  await r2.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: file,
      ContentType: contentType,
    })
  );

  return key;
}

// Keep old name as alias for backward compatibility
export const listFiles = listImages;

export async function deleteImage(key: string): Promise<void> {
  await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

export async function listAllFolderPaths(userId?: string): Promise<string[]> {
  const prefix = userId ? `${userId}/` : '';
  const command = new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix });
  const response = await r2.send(command);
  const objects = response.Contents || [];

  const folderPaths = new Set<string>();

  for (const obj of objects) {
    if (!obj.Key) continue;
    const key = userId ? obj.Key.slice(userId.length + 1) : obj.Key;

    if (key.endsWith('/')) {
      // Marker object = empty folder
      const folderPath = key.replace(/\/$/, '');
      if (folderPath && !folderPath.startsWith('_')) folderPaths.add(folderPath);
      continue;
    }

    const parts = key.split('/');
    let current = '';
    for (let i = 0; i < parts.length - 1; i++) {
      current = current ? `${current}/${parts[i]}` : parts[i];
      if (!current.startsWith('_')) folderPaths.add(current);
    }
  }

  return Array.from(folderPaths).sort();
}

export async function listFolders(userId?: string): Promise<string[]> {
  const prefix = userId ? `${userId}/` : '';
  const command = new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: prefix,
    Delimiter: '/',
  });

  const response = await r2.send(command);
  const prefixes = response.CommonPrefixes || [];

  return prefixes
    .map((p) => {
      const full = p.Prefix!.replace(/\/$/, '');
      // With userId prefix: "user_123/animals" → "animals"
      if (userId) {
        const parts = full.split('/');
        return parts.length > 1 ? parts[1] : '';
      }
      return full;
    })
    .filter((name) => name && !name.startsWith('_') && !name.startsWith('user_'));
}

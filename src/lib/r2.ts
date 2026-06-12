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

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.heic'];

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
        if (filename.startsWith('_')) return false;
        if (obj.Key.startsWith('_')) return false;
        const ext = filename.toLowerCase().split('.').pop();
        return ext !== undefined && IMAGE_EXTENSIONS.includes(`.${ext}`);
      })
      .map(async (obj) => {
        const url = await getSignedUrl(
          r2,
          new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key! }),
          { expiresIn: 3600 }
        );
        const parts = obj.Key!.split('/');
        // userId/folder/file.jpg → folder = parts[1], filename = parts[2]
        // userId/file.jpg        → folder = 'uncategorized', filename = parts[1]
        // folder/file.jpg (legacy) → folder = parts[0], filename = parts[1]
        const filename = parts[parts.length - 1];
        const folder = userId
          ? (parts.length > 2 ? parts[1] : 'uncategorized')
          : (parts.length > 1 ? parts[0] : 'uncategorized');

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
  const safe = filename.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9.\-_]/g, '');
  const key = userId
    ? `${userId}/${folder}/${Date.now()}-${safe}`
    : `${folder}/${Date.now()}-${safe}`;

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

export async function deleteImage(key: string): Promise<void> {
  await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
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

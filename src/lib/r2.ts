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

export async function listImages(folder?: string): Promise<GalleryImage[]> {
  const prefix = folder ? `${folder}/` : '';
  const command = new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: prefix,
  });

  const response = await r2.send(command);
  const objects = response.Contents || [];

  const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.heic'];

  const images: GalleryImage[] = await Promise.all(
    objects
      .filter((obj) => {
        if (!obj.Key || obj.Key.endsWith('/')) return false;
        if (obj.Key.startsWith('_')) return false;
        const ext = obj.Key.toLowerCase().split('.').pop();
        return ext !== undefined && IMAGE_EXTENSIONS.includes(`.${ext}`);
      })
      .map(async (obj) => {
        const url = await getSignedUrl(
          r2,
          new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key! }),
          { expiresIn: 3600 }
        );
        const parts = obj.Key!.split('/');
        return {
          key: obj.Key!,
          url,
          size: obj.Size || 0,
          lastModified: obj.LastModified || new Date(),
          folder: parts.length > 1 ? parts[0] : 'uncategorized',
          filename: parts[parts.length - 1],
        };
      })
  );

  return images.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
}

export async function uploadImage(
  file: Buffer,
  filename: string,
  contentType: string,
  folder: string = 'uncategorized'
): Promise<string> {
  const safe = filename.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9.\-_]/g, '');
  const key = `${folder}/${Date.now()}-${safe}`;

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
  await r2.send(
    new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: key,
    })
  );
}

export async function listFolders(): Promise<string[]> {
  const command = new ListObjectsV2Command({
    Bucket: BUCKET,
    Delimiter: '/',
  });

  const response = await r2.send(command);
  const prefixes = response.CommonPrefixes || [];
  return prefixes.map((p) => p.Prefix!.replace('/', '')).filter(Boolean);
}

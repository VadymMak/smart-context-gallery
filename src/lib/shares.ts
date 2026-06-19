import { r2, BUCKET } from '@/lib/r2';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { nanoid } from 'nanoid';

export interface Share {
  id: string;
  fileKey?: string;       // file shares
  folderPath?: string;    // folder shares — full R2 prefix, e.g. "user_123/TRUBARKA/"
  fileName: string;
  fileType: 'image' | 'video' | 'document' | 'folder';
  mode: 'download' | 'preview';
  createdBy: string;
  createdByName: string;
  createdAt: string;
  expiresAt?: string;
  viewCount: number;
  watermarkText?: string;
}

interface SharesData {
  shares: Record<string, Share>;
}

const SHARES_KEY = '_shares.json';

const MAX_RETRIES = 3;
const jitter = () => new Promise<void>((r) => setTimeout(r, 40 + Math.random() * 80));

async function loadSharesData(): Promise<SharesData> {
  try {
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: SHARES_KEY });
    const response = await r2.send(command);
    const body = await response.Body?.transformToString();
    if (!body) return { shares: {} };
    const parsed = JSON.parse(body);
    // Handle legacy array format gracefully
    if (Array.isArray(parsed?.shares)) return { shares: {} };
    return parsed as SharesData;
  } catch (error: unknown) {
    const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      return { shares: {} };
    }
    throw error;
  }
}

async function saveSharesData(data: SharesData): Promise<void> {
  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: SHARES_KEY,
    Body: JSON.stringify(data, null, 2),
    ContentType: 'application/json',
  }));
}

export async function getShares(): Promise<SharesData> {
  return loadSharesData();
}

export async function createShare(
  share: Omit<Share, 'id' | 'viewCount'>
): Promise<Share> {
  const newShare: Share = {
    ...share,
    id: nanoid(12),
    viewCount: 0,
  };

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const data = await loadSharesData();
    data.shares[newShare.id] = newShare;
    await saveSharesData(data);

    if (attempt < MAX_RETRIES - 1) {
      await jitter();
      const verify = await loadSharesData();
      if (verify.shares[newShare.id]) return newShare;
      console.warn(`[shares] Write conflict (attempt ${attempt + 1}/${MAX_RETRIES}), retrying…`);
    }
  }

  return newShare;
}

export async function deleteShare(shareId: string, userId: string): Promise<void> {
  const data = await loadSharesData();
  const share = data.shares[shareId];
  if (!share || share.createdBy !== userId) return;
  delete data.shares[shareId];
  await saveSharesData(data);
}

export async function getShareById(shareId: string): Promise<Share | null> {
  const data = await loadSharesData();
  return data.shares[shareId] ?? null;
}

export async function incrementViewCount(shareId: string): Promise<void> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const data = await loadSharesData();
    if (!data.shares[shareId]) return;
    data.shares[shareId].viewCount++;
    await saveSharesData(data);

    if (attempt < MAX_RETRIES - 1) {
      await jitter();
      const verify = await loadSharesData();
      if (verify.shares[shareId]) return;
    }
  }
}

export async function getUserShares(userId: string): Promise<Share[]> {
  const data = await loadSharesData();
  return Object.values(data.shares).filter((s) => s.createdBy === userId);
}

export function isShareExpired(share: Share): boolean {
  if (!share.expiresAt) return false;
  return new Date(share.expiresAt) < new Date();
}

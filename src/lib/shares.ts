import { r2, BUCKET } from '@/lib/r2';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';

export interface ShareEntry {
  token: string;
  type: 'image' | 'folder' | 'archive';
  target: string;
  userId: string;
  userName: string;
  createdAt: string;
  expiresAt: string;
  accessCount: number;
  isActive: boolean;
  label?: string;
}

interface ShareStore {
  shares: ShareEntry[];
}

const SHARES_KEY = '_shares.json';

export async function loadShares(): Promise<ShareStore> {
  try {
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: SHARES_KEY });
    const response = await r2.send(command);
    const body = await response.Body?.transformToString();
    if (!body) return { shares: [] };
    return JSON.parse(body);
  } catch (error: unknown) {
    const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      return { shares: [] };
    }
    throw error;
  }
}

export async function saveShares(store: ShareStore): Promise<void> {
  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: SHARES_KEY,
    Body: JSON.stringify(store, null, 2),
    ContentType: 'application/json',
  }));
}

function generateToken(): string {
  return crypto.randomBytes(16).toString('base64url');
}

export async function createShare(
  type: 'image' | 'folder' | 'archive',
  target: string,
  userId: string,
  userName: string,
  options?: { expiresInDays?: number; label?: string }
): Promise<ShareEntry> {
  const store = await loadShares();
  const expiresInDays = options?.expiresInDays ?? 7;
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

  const entry: ShareEntry = {
    token: generateToken(),
    type,
    target,
    userId,
    userName,
    createdAt: new Date().toISOString(),
    expiresAt,
    accessCount: 0,
    isActive: true,
    label: options?.label,
  };

  store.shares.push(entry);
  await saveShares(store);
  return entry;
}

export async function getShare(token: string): Promise<ShareEntry | null> {
  const store = await loadShares();
  const share = store.shares.find((s) => s.token === token);
  if (!share || !share.isActive) return null;
  if (new Date(share.expiresAt) < new Date()) return null;
  return share;
}

export async function incrementAccessCount(token: string): Promise<void> {
  const store = await loadShares();
  const share = store.shares.find((s) => s.token === token);
  if (share) {
    share.accessCount++;
    await saveShares(store);
  }
}

export async function revokeShare(token: string, userId: string): Promise<boolean> {
  const store = await loadShares();
  const share = store.shares.find((s) => s.token === token && s.userId === userId);
  if (!share) return false;
  share.isActive = false;
  await saveShares(store);
  return true;
}

export async function getUserShares(userId: string): Promise<ShareEntry[]> {
  const store = await loadShares();
  return store.shares.filter((s) => s.userId === userId && s.isActive);
}

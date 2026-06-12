import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { r2, BUCKET } from './r2';
import bcrypt from 'bcryptjs';

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'member';
  createdAt: string;
}

interface UserWithPassword extends User {
  passwordHash: string;
}

interface UserStore {
  users: UserWithPassword[];
}

const USERS_KEY = '_users.json';

async function loadUsers(): Promise<UserStore> {
  try {
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: USERS_KEY });
    const response = await r2.send(command);
    const body = await response.Body?.transformToString();
    if (!body) return { users: [] };
    return JSON.parse(body) as UserStore;
  } catch (error: unknown) {
    const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      return { users: [] };
    }
    throw error;
  }
}

async function saveUsers(store: UserStore): Promise<void> {
  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: USERS_KEY,
    Body: JSON.stringify(store, null, 2),
    ContentType: 'application/json',
  }));
}

export async function createUser(
  username: string,
  password: string,
  displayName: string,
  role: 'admin' | 'member' = 'member'
): Promise<User> {
  const store = await loadUsers();

  if (store.users.find((u) => u.username === username)) {
    throw new Error('Username already exists');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user: UserWithPassword = {
    id: `user_${Date.now()}`,
    username,
    displayName,
    role,
    createdAt: new Date().toISOString(),
    passwordHash,
  };

  store.users.push(user);
  await saveUsers(store);

  const { passwordHash: _ph, ...safeUser } = user;
  void _ph;
  return safeUser;
}

export async function verifyUser(username: string, password: string): Promise<User | null> {
  const store = await loadUsers();
  const user = store.users.find((u) => u.username === username);
  if (!user) return null;

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return null;

  const { passwordHash: _ph, ...safeUser } = user;
  void _ph;
  return safeUser;
}

export async function listUsers(): Promise<User[]> {
  const store = await loadUsers();
  return store.users.map(({ passwordHash: _ph, ...u }) => { void _ph; return u; });
}

export async function deleteUser(userId: string): Promise<void> {
  const store = await loadUsers();
  store.users = store.users.filter((u) => u.id !== userId);
  await saveUsers(store);
}

export async function hasUsers(): Promise<boolean> {
  const store = await loadUsers();
  return store.users.length > 0;
}

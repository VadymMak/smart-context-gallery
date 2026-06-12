import { isAuthenticated, getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { listImages, listAllFolderPaths } from '@/lib/r2';
import { loadMetadata } from '@/lib/metadata';
import { GalleryClient } from '@/components/GalleryClient';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const authed = await isAuthenticated();
  if (!authed) redirect('/login');

  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const [images, folders, metadataStore] = await Promise.all([
    listImages(undefined, user.id),
    listAllFolderPaths(user.id),
    loadMetadata(),
  ]);

  // Scope metadata to this user's images only
  const userMetadata = Object.fromEntries(
    Object.entries(metadataStore.images).filter(([key]) => key.startsWith(`${user.id}/`))
  );
  const userProjects = [
    ...new Set(
      Object.values(userMetadata)
        .map((m) => m.project)
        .filter((p): p is string => !!p)
    ),
  ];

  return (
    <main className="min-h-screen bg-gray-50">
      <GalleryClient
        initialImages={images}
        initialFolders={folders}
        initialMetadata={userMetadata}
        initialProjects={userProjects}
        user={user}
      />
    </main>
  );
}

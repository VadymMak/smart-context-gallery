import { isAuthenticated, getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { listImages, listFolders } from '@/lib/r2';
import { loadMetadata } from '@/lib/metadata';
import { GalleryClient } from '@/components/GalleryClient';

export default async function HomePage() {
  const authed = await isAuthenticated();
  if (!authed) redirect('/login');

  const [images, folders, metadataStore, currentUser] = await Promise.all([
    listImages(),
    listFolders(),
    loadMetadata(),
    getCurrentUser(),
  ]);

  return (
    <main className="min-h-screen bg-gray-50">
      <GalleryClient
        initialImages={images}
        initialFolders={folders}
        initialMetadata={metadataStore.images}
        initialProjects={metadataStore.projects}
        currentUser={currentUser}
      />
    </main>
  );
}

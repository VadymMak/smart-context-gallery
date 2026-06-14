'use client';

import dynamic from 'next/dynamic';
import type { GalleryImage } from '@/lib/r2';
import type { ImageMetadata } from '@/lib/metadata';

const GalleryClientDynamic = dynamic(
  () => import('./GalleryClient').then((m) => ({ default: m.GalleryClient })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    ),
  }
);

interface CurrentUser {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'member';
}

interface Props {
  initialImages: GalleryImage[];
  initialFolders: string[];
  initialMetadata: Record<string, ImageMetadata>;
  initialProjects: string[];
  user: CurrentUser | null;
}

export function GalleryClientLoader(props: Props) {
  return <GalleryClientDynamic {...props} />;
}

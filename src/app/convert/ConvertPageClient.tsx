'use client';

import dynamic from 'next/dynamic';

const VideoConverter = dynamic(
  () => import('@/components/VideoConverter'),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center min-h-screen bg-gray-950">
        <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    ),
  }
);

export default function ConvertPageClient() {
  return <VideoConverter />;
}

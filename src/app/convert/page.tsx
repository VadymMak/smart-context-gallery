import type { Metadata } from 'next';
import VideoConverter from '@/components/VideoConverter';

export const metadata: Metadata = {
  title: 'Video Converter — AK Storage',
  description: 'Client-side video converter powered by FFmpeg WASM',
  robots: 'noindex, nofollow',
};

export default function ConvertPage() {
  return <VideoConverter />;
}

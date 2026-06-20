import type { Metadata } from 'next';
import ConvertPageClient from './ConvertPageClient';

export const metadata: Metadata = {
  title: 'Video Converter — AK Storage',
  description: 'Client-side video converter powered by FFmpeg WASM',
  robots: 'noindex, nofollow',
};

export default function ConvertPage() {
  return <ConvertPageClient />;
}

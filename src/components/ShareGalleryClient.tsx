'use client';

import { useState } from 'react';

interface ShareImage {
  key: string;
  url: string;
  filename: string;
}

interface Props {
  images: ShareImage[];
  title: string;
  sharedBy: string;
  expiresAt: string;
  token: string;
}

export function ShareGalleryClient({ images, title, sharedBy, expiresAt, token }: Props) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  return (
    <>
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <h1 className="text-xl font-bold text-gray-800">{title}</h1>
        <p className="text-sm text-gray-500 mt-1" suppressHydrationWarning>
          {images.length} image{images.length !== 1 ? 's' : ''} · Shared by {sharedBy} · Expires {new Date(expiresAt).toLocaleDateString()}
        </p>
        <a
          href={`/share/${token}/download`}
          className="inline-flex items-center gap-2 mt-3 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download all
        </a>
      </div>

      <div className="p-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {images.map((img, i) => (
          <div
            key={img.key}
            className="rounded-xl overflow-hidden cursor-pointer hover:shadow-lg transition-shadow aspect-square"
            onClick={() => setLightboxIndex(i)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.url} alt={img.filename} className="w-full h-full object-cover" />
          </div>
        ))}
      </div>

      {lightboxIndex !== null && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center"
          onClick={() => setLightboxIndex(null)}
        >
          <button
            onClick={() => setLightboxIndex(null)}
            className="absolute top-4 right-4 text-white/70 hover:text-white p-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>

          {lightboxIndex > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setLightboxIndex((i) => (i !== null ? i - 1 : i)); }}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white p-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
          )}
          {lightboxIndex < images.length - 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); setLightboxIndex((i) => (i !== null ? i + 1 : i)); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white p-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          )}

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={images[lightboxIndex].url}
            alt=""
            className="max-h-[90vh] max-w-[90vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />

          <p className="absolute bottom-4 text-white/60 text-sm">
            {images[lightboxIndex].filename} · {lightboxIndex + 1} / {images.length}
          </p>
        </div>
      )}
    </>
  );
}

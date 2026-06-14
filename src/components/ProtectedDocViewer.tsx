'use client';

import { useEffect, useState } from 'react';

interface Props {
  shareId: string;
  sharedBy: string;
  fileName: string;
}

export default function ProtectedDocViewer({ shareId, sharedBy }: Props) {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isBlurred, setIsBlurred] = useState(false);

  // Block right-click, Cmd+S, Cmd+P, Cmd+A, Cmd+C, PrintScreen
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => e.preventDefault();
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (
        (mod && (e.key === 's' || e.key === 'p' || e.key === 'a' || e.key === 'c')) ||
        e.key === 'PrintScreen'
      ) {
        e.preventDefault();
      }
    };
    const handleCopy = (e: ClipboardEvent) => e.preventDefault();
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('copy', handleCopy);
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('copy', handleCopy);
    };
  }, []);

  // Blur on focus loss
  useEffect(() => {
    const handleBlur = () => setIsBlurred(true);
    const handleFocus = () => setTimeout(() => setIsBlurred(false), 500);
    const handleVisibility = () => { if (document.hidden) setIsBlurred(true); };
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // Load DOCX → HTML conversion
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/share/${shareId}/preview`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load preview');
        if (!cancelled) {
          setHtml(data.html);
          setLoading(false);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load document');
          setLoading(false);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [shareId]);

  // SVG watermark data URI — tiled via CSS background
  const watermarkSvg = `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='140'>
    <text x='50%' y='70' dominant-baseline='middle' text-anchor='middle'
      font-family='sans-serif' font-size='13' fill='rgba(0,0,0,0.06)'
      transform='rotate(-30 150 70)'>Shared by ${sharedBy}</text>
  </svg>`;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-gray-400 text-sm">Converting document…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="relative w-full max-w-4xl mx-auto" style={{ WebkitUserSelect: 'none', userSelect: 'none' } as React.CSSProperties}>
      {/* Blur overlay on focus loss */}
      {isBlurred && (
        <div
          className="absolute inset-0 z-50 backdrop-blur-xl bg-black/60 flex items-center justify-center rounded-xl cursor-pointer"
          onClick={() => setIsBlurred(false)}
        >
          <p className="text-white text-lg font-medium">Click to continue viewing</p>
        </div>
      )}

      {/* Watermark overlay — repeating SVG pattern */}
      <div
        className="absolute inset-0 z-30 pointer-events-none overflow-hidden rounded-xl"
        aria-hidden="true"
        style={{
          backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(watermarkSvg)}")`,
          backgroundRepeat: 'repeat',
        }}
      />

      {/* Document content */}
      <div
        className="relative z-10 bg-white rounded-xl shadow-2xl overflow-auto max-h-[80vh] p-8 md:p-12"
        style={{ userSelect: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}
        onContextMenu={(e) => e.preventDefault()}
        onCopy={(e) => e.preventDefault()}
      >
        {/* Rendered HTML from mammoth (server-side conversion — no script tags) */}
        <div
          className="text-gray-900 leading-relaxed [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-4 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mb-3 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mb-2 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-3 [&_li]:mb-1 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-gray-300 [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:border-gray-300 [&_th]:px-3 [&_th]:py-2 [&_th]:font-semibold [&_th]:bg-gray-50 [&_strong]:font-semibold [&_em]:italic"
          dangerouslySetInnerHTML={{ __html: html }}
          style={{ userSelect: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}
        />
      </div>
    </div>
  );
}

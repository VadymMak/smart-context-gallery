'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  fileUrl: string;
  sharedBy: string;
  fileName: string;
}

export default function ProtectedPdfViewer({ fileUrl, sharedBy }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isBlurred, setIsBlurred] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfDocRef = useRef<any>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());

  // Block right-click, Cmd+S, Cmd+P, PrintScreen
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => e.preventDefault();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey && (e.key === 's' || e.key === 'p')) ||
        (e.metaKey && (e.key === 's' || e.key === 'p')) ||
        e.key === 'PrintScreen'
      ) {
        e.preventDefault();
      }
    };
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('keydown', handleKeyDown);
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

  const drawWatermark = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      ctx.save();
      ctx.globalAlpha = 0.07;
      ctx.font = `${Math.max(14, w * 0.025)}px sans-serif`;
      ctx.fillStyle = '#000000';
      ctx.translate(w / 2, h / 2);
      ctx.rotate(-Math.PI / 6);
      const text = `Shared by ${sharedBy}`;
      const stepX = Math.max(200, w * 0.32);
      const stepY = Math.max(60, h * 0.12);
      for (let y = -h; y < h * 2; y += stepY) {
        for (let x = -w; x < w * 2; x += stepX) {
          ctx.fillText(text, x - w / 2, y - h / 2);
        }
      }
      ctx.restore();
    },
    [sharedBy]
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderPage = useCallback(async (pdf: any, pageNum: number) => {
    try {
      const page = await pdf.getPage(pageNum);
      const scale = 1.5;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRefs.current.get(pageNum);
      if (!canvas) return;
      const context = canvas.getContext('2d');
      if (!context) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: context, viewport }).promise;
      drawWatermark(context, canvas.width, canvas.height);
    } catch (err) {
      console.error(`[pdf] Error rendering page ${pageNum}:`, err);
    }
  }, [drawWatermark]);

  // Load PDF via pdfjs-dist (dynamic import — heavy library)
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
        const pdf = await pdfjsLib.getDocument({ url: fileUrl }).promise;
        if (cancelled) return;
        pdfDocRef.current = pdf;
        setNumPages(pdf.numPages);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          console.error('[pdf] Load error:', err);
          setError('Failed to load PDF');
          setLoading(false);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [fileUrl]);

  // Render all pages once numPages is known and canvases are mounted
  useEffect(() => {
    if (!pdfDocRef.current || numPages === 0) return;
    for (let i = 1; i <= numPages; i++) {
      renderPage(pdfDocRef.current, i);
    }
  }, [numPages, renderPage]);

  const goToPage = useCallback((pageNum: number) => {
    if (pageNum < 1 || pageNum > numPages) return;
    setCurrentPage(pageNum);
    const canvas = canvasRefs.current.get(pageNum);
    canvas?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [numPages]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-gray-400 text-sm">Loading PDF…</p>
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
    <div className="relative select-none w-full" style={{ WebkitUserSelect: 'none' } as React.CSSProperties}>
      {/* Blur overlay on focus loss */}
      {isBlurred && (
        <div
          className="absolute inset-0 z-50 backdrop-blur-xl bg-black/60 flex items-center justify-center rounded-xl cursor-pointer"
          onClick={() => setIsBlurred(false)}
        >
          <p className="text-white text-lg font-medium">Click to continue viewing</p>
        </div>
      )}

      {/* Page navigation */}
      <div className="sticky top-0 z-40 bg-gray-900/90 backdrop-blur-sm py-2 px-4 flex items-center justify-center gap-4 text-sm text-gray-300 border-b border-white/10">
        <button
          onClick={() => goToPage(currentPage - 1)}
          disabled={currentPage <= 1}
          className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          ← Prev
        </button>
        <span>Page {currentPage} of {numPages}</span>
        <button
          onClick={() => goToPage(currentPage + 1)}
          disabled={currentPage >= numPages}
          className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Next →
        </button>
      </div>

      {/* Canvas pages — scroll view */}
      <div
        ref={containerRef}
        className="flex flex-col items-center gap-4 py-4 px-2 overflow-auto max-h-[80vh]"
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
      >
        {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => (
          <canvas
            key={pageNum}
            ref={(el) => {
              if (el) canvasRefs.current.set(pageNum, el);
            }}
            className="max-w-full shadow-lg rounded"
            style={{ pointerEvents: 'none' }}
            onContextMenu={(e) => e.preventDefault()}
          />
        ))}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  shareId: string;
  watermarkText: string;
  fileUrl?: string; // override default /api/share/${shareId}/file for folder items
}

export function ProtectedImageViewer({ shareId, watermarkText, fileUrl }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [blurred, setBlurred] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load image via proxy and draw onto canvas with watermark
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = fileUrl ?? `/api/share/${shareId}/file`;

    img.onload = () => {
      const maxW = window.innerWidth * 0.95;
      const maxH = window.innerHeight * 0.88;
      const scaleW = Math.min(1, maxW / img.width);
      const scaleH = Math.min(1, maxH / img.height);
      const scale = Math.min(scaleW, scaleH);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);

      // Draw image
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Draw diagonal repeating watermark
      ctx.save();
      ctx.globalAlpha = 0.07;
      ctx.font = '20px sans-serif';
      ctx.fillStyle = '#000000';
      ctx.rotate(-30 * Math.PI / 180);

      const text = watermarkText || 'Preview Only';
      for (let y = -canvas.height; y < canvas.height * 2; y += 80) {
        for (let x = -canvas.width; x < canvas.width * 2; x += 280) {
          ctx.fillText(text, x, y);
        }
      }
      ctx.restore();
      setLoading(false);
    };

    img.onerror = () => setLoading(false);
  }, [shareId, watermarkText, fileUrl]);

  // Blur on focus loss / tab switch
  useEffect(() => {
    const handleVisibilityChange = () => { if (document.hidden) setBlurred(true); };
    const handleBlur = () => setBlurred(true);
    const handleFocus = () => setTimeout(() => setBlurred(false), 500);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  // Block save/print shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey && (e.key === 's' || e.key === 'p')) ||
        (e.metaKey && (e.key === 's' || e.key === 'p')) ||
        e.key === 'PrintScreen'
      ) {
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative select-none"
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
      style={{ WebkitUserSelect: 'none', WebkitTouchCallout: 'none' } as React.CSSProperties}
    >
      {loading && (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      <canvas
        ref={canvasRef}
        className={`max-w-full rounded-xl shadow-2xl ${loading ? 'hidden' : 'block'}`}
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
      />

      {/* Blur overlay on focus loss */}
      {blurred && (
        <div
          className="absolute inset-0 backdrop-blur-2xl bg-black/40 flex items-center justify-center z-10 cursor-pointer rounded-xl"
          onClick={() => setBlurred(false)}
        >
          <p className="text-white/90 text-lg font-medium">Click to continue viewing</p>
        </div>
      )}
    </div>
  );
}

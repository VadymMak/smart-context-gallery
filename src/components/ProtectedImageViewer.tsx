'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface Props {
  shareId: string;
  watermarkText: string;
  fileName: string;
}

export function ProtectedImageViewer({ shareId, watermarkText, fileName }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [blurred, setBlurred] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const drawImage = useCallback((img: HTMLImageElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;

    // Draw original image
    ctx.drawImage(img, 0, 0);

    // Draw diagonal repeating watermark
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.font = '24px sans-serif';
    ctx.fillStyle = '#000000';
    ctx.rotate(-30 * Math.PI / 180);

    for (let y = -canvas.height; y < canvas.height * 2; y += 80) {
      for (let x = -canvas.width; x < canvas.width * 2; x += 300) {
        ctx.fillText(watermarkText, x, y);
      }
    }
    ctx.restore();
  }, [watermarkText]);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      drawImage(img);
      setLoaded(true);
    };
    img.onerror = () => setError(true);
    img.src = `/api/share/${shareId}/file`;
  }, [shareId, drawImage]);

  // Blur on focus loss
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) setBlurred(true);
    };
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

  // Block keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey && e.key === 's') ||
        (e.metaKey && e.key === 's') ||
        (e.ctrlKey && e.key === 'p') ||
        (e.metaKey && e.key === 'p') ||
        e.key === 'PrintScreen'
      ) {
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        Failed to load image
      </div>
    );
  }

  return (
    <div
      className="relative select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      {!loaded && (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
        </div>
      )}

      <div
        className="relative"
        style={{ display: loaded ? 'block' : 'none' }}
        onDragStart={(e) => e.preventDefault()}
      >
        <canvas
          ref={canvasRef}
          className="max-w-full h-auto rounded-xl shadow-2xl"
          style={{
            userSelect: 'none',
            WebkitUserSelect: 'none',
            pointerEvents: 'none',
          }}
          aria-label={fileName}
        />

        {/* Blur overlay on focus loss */}
        {blurred && (
          <div
            className="absolute inset-0 backdrop-blur-xl bg-white/50 flex items-center justify-center z-10 rounded-xl cursor-pointer"
            onClick={() => setBlurred(false)}
          >
            <p className="text-gray-600 text-base font-medium">Click to continue viewing</p>
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  shareId: string;
  watermarkText: string;
}

export function ProtectedVideoPlayer({ shareId, watermarkText }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [blurred, setBlurred] = useState(false);

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

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    // Bottom 44px is typically the native video controls area
    const isControlsArea = e.clientY > rect.bottom - 44;
    if (!isControlsArea && videoRef.current) {
      videoRef.current.paused ? videoRef.current.play() : videoRef.current.pause();
    }
  };

  return (
    <div
      className="relative select-none w-full max-w-4xl"
      onContextMenu={(e) => e.preventDefault()}
      style={{ WebkitUserSelect: 'none' } as React.CSSProperties}
    >
      {/* Video element */}
      <video
        ref={videoRef}
        src={`/api/share/${shareId}/file`}
        controls
        controlsList="nodownload noplaybackrate"
        disablePictureInPicture
        playsInline
        className="w-full max-h-[70vh] rounded-xl shadow-2xl"
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* SVG pattern watermark overlay — rendered directly over video */}
      <div className="absolute inset-0 pointer-events-none select-none z-10 rounded-xl overflow-hidden">
        <svg
          className="w-full h-full opacity-[0.06]"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <pattern
              id="wm"
              patternUnits="userSpaceOnUse"
              width="250"
              height="80"
              patternTransform="rotate(-30)"
            >
              <text
                x="10"
                y="40"
                fill="white"
                fontSize="16"
                fontFamily="sans-serif"
              >
                {watermarkText}
              </text>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#wm)" />
        </svg>
      </div>

      {/* Transparent click interceptor — blocks right-click, passes play/pause to video controls */}
      <div
        className="absolute inset-0 rounded-xl"
        style={{ zIndex: 20, pointerEvents: 'auto' }}
        onContextMenu={(e) => e.preventDefault()}
        onClick={handleOverlayClick}
      />

      {/* Blur overlay on focus loss */}
      {blurred && (
        <div
          className="absolute inset-0 backdrop-blur-2xl bg-black/50 flex items-center justify-center rounded-xl cursor-pointer"
          style={{ zIndex: 30 }}
          onClick={() => setBlurred(false)}
        >
          <p className="text-white/90 text-lg font-medium">Click to continue</p>
        </div>
      )}
    </div>
  );
}

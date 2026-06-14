'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  shareId: string;
  watermarkText: string;
  fileName: string;
}

const WATERMARK_SVG = (text: string) => {
  const encoded = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100">
      <text x="10" y="60" font-family="sans-serif" font-size="20" fill="rgba(0,0,0,0.15)" transform="rotate(-20, 200, 50)">${text}</text>
    </svg>`
  );
  return `url("data:image/svg+xml,${encoded}")`;
};

export function ProtectedVideoPlayer({ shareId, watermarkText, fileName }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [blurred, setBlurred] = useState(false);
  const [videoSrc, setVideoSrc] = useState('');

  // Fetch short-lived signed URL for video
  useEffect(() => {
    fetch(`/api/share/${shareId}/file`)
      .then((res) => res.json())
      .then((data) => { if (data.url) setVideoSrc(data.url); })
      .catch(() => {});
  }, [shareId]);

  // Blur on focus loss
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

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const isControlsArea = e.clientY > rect.bottom - 44;
    if (!isControlsArea && videoRef.current) {
      videoRef.current.paused ? videoRef.current.play() : videoRef.current.pause();
    }
  };

  if (!videoSrc) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div
      className="relative select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Native video element */}
      <video
        ref={videoRef}
        src={videoSrc}
        controls
        controlsList="nodownload noplaybackrate"
        disablePictureInPicture
        playsInline
        className="w-full max-h-[80vh] rounded-xl shadow-2xl"
        onContextMenu={(e) => e.preventDefault()}
        aria-label={fileName}
      />

      {/* Repeating watermark overlay */}
      <div
        className="absolute inset-0 pointer-events-none select-none rounded-xl overflow-hidden"
        style={{
          backgroundImage: WATERMARK_SVG(watermarkText),
          backgroundRepeat: 'repeat',
          transform: 'rotate(-15deg) scale(1.5)',
          transformOrigin: 'center',
          zIndex: 10,
        }}
      />

      {/* Transparent click interceptor — blocks right-click, passes play/pause */}
      <div
        className="absolute inset-0 rounded-xl"
        style={{ zIndex: 20, pointerEvents: 'auto' }}
        onContextMenu={(e) => e.preventDefault()}
        onClick={handleOverlayClick}
      />

      {/* Blur overlay on focus loss */}
      {blurred && (
        <div
          className="absolute inset-0 backdrop-blur-xl bg-white/50 flex items-center justify-center rounded-xl cursor-pointer"
          style={{ zIndex: 30 }}
          onClick={() => setBlurred(false)}
        >
          <p className="text-gray-600 text-base font-medium">Click to continue</p>
        </div>
      )}
    </div>
  );
}

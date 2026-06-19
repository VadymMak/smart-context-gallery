'use client';
import { useEffect, useRef, useState } from 'react';

type ThumbState = 'idle' | 'loading' | 'loaded' | 'error';

interface LazyThumbProps {
  thumbUrl: string;
  isRaw?: boolean;
  className?: string;
}

export function LazyThumb({ thumbUrl, isRaw, className }: LazyThumbProps) {
  const [state, setState] = useState<ThumbState>('idle');
  const [progress, setProgress] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          observer.disconnect();
          startLoading();
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thumbUrl]);

  function startLoading() {
    setState('loading');
    setProgress(0);

    const duration = isRaw ? 3000 : 800;
    const step = 100 / (duration / 50);
    let current = 0;

    intervalRef.current = setInterval(() => {
      current += step;
      // Eases to 92% max, waiting for the real response
      const eased = current < 80 ? current : 80 + (current - 80) * 0.1;
      setProgress(Math.min(eased, 92));
    }, 50);

    const img = new Image();
    img.onload = () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setProgress(100);
      setTimeout(() => setState('loaded'), 150);
    };
    img.onerror = () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setState('error');
    };
    img.src = thumbUrl;
  }

  return (
    <div ref={containerRef} className={className} style={{ position: 'relative', overflow: 'hidden' }}>

      {/* Skeleton — shown while idle or loading */}
      {(state === 'idle' || state === 'loading') && (
        <div className="thumb-skeleton" style={{ position: 'absolute', inset: 0 }}>
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            {isRaw ? (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="1.5">
                <rect x="2" y="6" width="20" height="14" rx="2"/>
                <circle cx="12" cy="13" r="3.5"/>
                <path d="M8 6V4h8v2"/>
              </svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <path d="m21 15-5-5L5 21"/>
              </svg>
            )}
            {isRaw && state === 'loading' && (
              <span style={{ fontSize: 10, color: '#555', letterSpacing: '0.05em' }}>RAW</span>
            )}
          </div>

          {/* Progress bar */}
          {state === 'loading' && (
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, background: '#111' }}>
              <div style={{
                height: '100%',
                width: `${progress}%`,
                background: 'linear-gradient(90deg, #3b82f6, #60a5fa)',
                transition: 'width 0.1s linear',
                borderRadius: '0 2px 2px 0',
              }} />
            </div>
          )}
        </div>
      )}

      {/* Real image — fades in on load */}
      {state === 'loaded' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbUrl}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#111', animation: 'thumbFadeIn 0.3s ease' }}
        />
      )}

      {/* Error — file icon */}
      {state === 'error' && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#111',
        }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
        </div>
      )}
    </div>
  );
}

'use client';
import { useEffect, useRef, useState } from 'react';

interface LazyThumbProps {
  thumbUrl: string;
  alt: string;
  className?: string;
  onError?: () => void;
}

export function LazyThumb({ thumbUrl, alt, className, onError }: LazyThumbProps) {
  const [src, setSrc] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSrc(thumbUrl);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [thumbUrl]);

  return (
    <div ref={ref} className={className}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          className="w-full h-full object-cover"
          onError={onError ? () => onError() : undefined}
        />
      ) : (
        <div className="w-full h-full bg-gray-100 animate-pulse" />
      )}
    </div>
  );
}

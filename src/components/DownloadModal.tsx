'use client';

interface DownloadModalProps {
  fileKey: string;
  fileName: string;
  fileSizeMB: number;
  onClose: () => void;
}

const RAW_EXT = /\.(cr2|cr3|nef|arw|dng|raf|rw2|orf|pef)$/i;

export function DownloadModal({ fileKey, fileName, fileSizeMB, onClose }: DownloadModalProps) {
  const isRaw = RAW_EXT.test(fileKey);

  const options = isRaw ? [
    {
      label: 'WebP',
      description: 'Compressed, ideal for web and sharing',
      size: '~150 KB',
      icon: '🖼️',
      url: `/api/thumb?key=${encodeURIComponent(fileKey)}&download=1`,
      accent: false,
    },
    {
      label: 'JPEG Preview',
      description: 'Extracted from RAW, good quality',
      size: '~1.5 MB',
      icon: '📷',
      url: `/api/raw-preview?key=${encodeURIComponent(fileKey)}&format=jpeg&download=1`,
      accent: false,
    },
    {
      label: `Original ${fileName.split('.').pop()?.toUpperCase()}`,
      description: '⚠️ Full RAW file — requires Lightroom or Camera Raw',
      size: `${fileSizeMB} MB`,
      icon: '📦',
      url: `${fileKey}`,
      accent: true,
    },
  ] : [
    {
      label: 'Download',
      description: 'Original file',
      size: `${fileSizeMB} MB`,
      icon: '⬇️',
      url: `${fileKey}`,
      accent: false,
    },
  ];

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'white', borderRadius: 16, padding: 24, width: 340,
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600 }}>Download</h3>
        <p style={{ margin: '0 0 20px', fontSize: 13, color: '#6b7280' }}>{fileName}</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {options.map((opt) => (
            <a
              key={opt.label}
              href={opt.url}
              download
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 16px', borderRadius: 10,
                border: opt.accent ? '1px solid #fca5a5' : '1px solid #e5e7eb',
                background: opt.accent ? '#fff7f7' : '#f9fafb',
                textDecoration: 'none', color: 'inherit', cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 22 }}>{opt.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{opt.label}</div>
                <div style={{ fontSize: 12, color: opt.accent ? '#ef4444' : '#6b7280' }}>
                  {opt.description}
                </div>
              </div>
              <span style={{ fontSize: 12, color: '#9ca3af', whiteSpace: 'nowrap' }}>
                {opt.size}
              </span>
            </a>
          ))}
        </div>

        <button
          onClick={onClose}
          style={{
            marginTop: 16, width: '100%', padding: '10px',
            border: 'none', borderRadius: 8, background: '#f3f4f6',
            cursor: 'pointer', fontSize: 14, color: '#374151',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

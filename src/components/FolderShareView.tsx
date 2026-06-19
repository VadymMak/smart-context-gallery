'use client';

import { useState, useEffect, useCallback } from 'react';
import { ProtectedImageViewer } from '@/components/ProtectedImageViewer';

interface FileItem {
  key: string;
  filename: string;
  size: number;
  ext: string;
  isImage: boolean;
  isRaw: boolean;
  isDocument: boolean;
  isVideo: boolean;
}

const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024;

const THUMB_EXTS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'heic',
  'cr2', 'cr3', 'nef', 'arw', 'dng', 'raf', 'rw2', 'orf', 'pef',
]);

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function fileIcon(file: FileItem): string {
  if (file.isRaw) return '📷';
  if (file.isImage) return '🖼';
  if (file.isVideo) return '🎬';
  if (file.isDocument) return '📄';
  return '📁';
}

// Single endpoint for all thumbnails (image + RAW)
function getThumbUrl(file: FileItem, shareId: string): string | null {
  if (!THUMB_EXTS.has(file.ext)) return null;
  return `/api/share/${shareId}/thumb?key=${encodeURIComponent(file.key)}&sz=${file.size}`;
}

// Display name: strip timestamp prefix (e.g. "1781867787686-img.cr2" → "img.cr2")
function displayName(filename: string): string {
  return filename.replace(/^\d{13}-/, '');
}

// ── Grid card with lazy thumbnail ─────────────────────────────────────────────
function GridCard({
  file,
  shareId,
  selected,
  allowSelect,
  onToggle,
  onPreview,
}: {
  file: FileItem;
  shareId: string;
  selected: boolean;
  allowSelect: boolean;
  onToggle: (key: string) => void;
  onPreview: (file: FileItem) => void;
}) {
  const url = getThumbUrl(file, shareId);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');

  return (
    <div
      onClick={() => onPreview(file)}
      className="relative bg-white rounded-xl overflow-hidden border-2 transition-all cursor-pointer border-gray-100 hover:border-gray-300"
    >
      {/* Thumbnail area — 4:3 aspect ratio */}
      <div className="relative w-full pb-[75%] bg-gray-100 overflow-hidden">
        {/* Placeholder (shown while loading or on error) */}
        {status !== 'ok' && (
          <div className="absolute inset-0 flex items-center justify-center text-4xl text-gray-300 select-none">
            {fileIcon(file)}
          </div>
        )}

        {url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={file.filename}
            loading="lazy"
            onLoad={() => setStatus('ok')}
            onError={() => setStatus('error')}
            className={`absolute inset-0 w-full h-full object-cover select-none transition-opacity duration-200 ${
              status === 'ok' ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )}

        {/* Checkbox overlay — stopPropagation so it doesn't open lightbox */}
        {allowSelect && (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggle(file.key)}
            onClick={(e) => { e.stopPropagation(); onToggle(file.key); }}
            className="absolute top-1.5 left-1.5 w-4 h-4 accent-blue-600 cursor-pointer z-10"
          />
        )}

        {/* RAW badge */}
        {file.isRaw && (
          <span className="absolute top-1.5 right-1.5 bg-black/60 text-white text-[10px] font-bold px-1.5 py-0.5 rounded z-10">
            RAW
          </span>
        )}

        {/* Selected overlay */}
        {selected && (
          <div className="absolute inset-0 bg-blue-500/10 pointer-events-none" />
        )}
      </div>

      {/* File info */}
      <div className="px-2 py-1.5">
        <p className="text-xs font-medium text-gray-800 truncate" title={file.filename}>
          {displayName(file.filename)}
        </p>
        <p className="text-[11px] text-gray-400 mt-0.5">{formatSize(file.size)}</p>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
interface Props {
  shareId: string;
  folderName: string;
  mode: 'preview' | 'download';
}

export function FolderShareView({ shareId, folderName, mode }: Props) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('grid');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [lightboxFile, setLightboxFile] = useState<FileItem | null>(null);

  useEffect(() => {
    fetch(`/api/share/${shareId}/files`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return; }
        setFiles(d.files);
      })
      .catch(() => setError('Failed to load files'))
      .finally(() => setLoading(false));
  }, [shareId]);

  const filtered = files.filter((f) =>
    f.filename.toLowerCase().includes(search.toLowerCase())
  );

  const toggle = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  const selectAll = () => setSelected(new Set(filtered.map((f) => f.key)));
  const clearAll  = () => setSelected(new Set());

  const selectedFiles = files.filter((f) => selected.has(f.key));
  const selectedBytes = selectedFiles.reduce((s, f) => s + f.size, 0);
  const overLimit     = selectedBytes > MAX_DOWNLOAD_BYTES;

  async function handleDownload() {
    if (selected.size === 0 || overLimit) return;
    setDownloading(true);
    setDownloadError('');
    try {
      const res = await fetch(`/api/share/${shareId}/download-selected`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedKeys: Array.from(selected) }),
      });
      if (!res.ok) {
        const data = await res.json();
        setDownloadError(data.error || 'Download failed');
        return;
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `${folderName}-selected.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setDownloadError('Network error');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sticky header */}
      <header className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3">
          {/* Top row */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 mr-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-500">
                <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
              </svg>
              <span className="font-semibold text-sm text-gray-800">AK Storage</span>
            </div>

            <div className="flex items-center gap-1.5">
              <svg className="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
                <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z"/>
              </svg>
              <h1 className="font-bold text-gray-900 text-sm">{folderName}</h1>
              {!loading && (
                <span className="text-xs text-gray-400">· {files.length} files</span>
              )}
            </div>

            <span className={`ml-auto flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
              mode === 'preview' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
            }`}>
              {mode === 'preview' ? '👁 Preview only' : '⬇ Download enabled'}
            </span>
          </div>

          {/* Controls row */}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <input
              type="search"
              placeholder="Search files…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-400 w-52"
            />

            {mode === 'download' && (
              <>
                <button onClick={selectAll} className="text-sm text-blue-600 hover:underline px-1">
                  Select all ({filtered.length})
                </button>
                <span className="text-gray-300">|</span>
                <button onClick={clearAll} className="text-sm text-gray-500 hover:underline px-1">
                  Clear
                </button>
              </>
            )}

            <button
              onClick={() => setViewMode((v) => v === 'list' ? 'grid' : 'list')}
              className="ml-auto border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-50 flex items-center gap-1"
            >
              {viewMode === 'list' ? <><span>⊞</span> Grid</> : <><span>☰</span> List</>}
            </button>
          </div>

          {/* Download bar */}
          {mode === 'download' && selected.size > 0 && (
            <div className="flex items-center gap-3 mt-2 pt-2 border-t border-gray-100 flex-wrap">
              <span className="text-sm text-gray-600">
                <span className="font-semibold">{selected.size}</span> selected · {formatSize(selectedBytes)}
              </span>
              {overLimit && (
                <span className="text-xs text-red-500 font-medium">⚠ Exceeds 500 MB limit</span>
              )}
              {downloadError && (
                <span className="text-xs text-red-500">{downloadError}</span>
              )}
              <button
                onClick={handleDownload}
                disabled={downloading || overLimit}
                className={`ml-auto flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                  downloading || overLimit
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {downloading ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" d="M12 3a9 9 0 110 18A9 9 0 0112 3z" opacity={.3}/>
                      <path strokeLinecap="round" d="M12 3a9 9 0 019 9" />
                    </svg>
                    Zipping…
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"/>
                    </svg>
                    Download ZIP ({selected.size})
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Body */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        {loading && <div className="text-center py-20 text-gray-400 text-sm">Loading…</div>}
        {error   && <div className="text-center py-20 text-red-500 text-sm">{error}</div>}

        {!loading && !error && filtered.length === 0 && (
          <div className="text-center py-20 text-gray-400 text-sm">
            {search ? 'No files match your search.' : 'This folder is empty.'}
          </div>
        )}

        {/* ── List view ──────────────────────────────────────────────── */}
        {!loading && !error && viewMode === 'list' && filtered.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden shadow-sm">
            {filtered.map((file, i) => (
              <ListRow
                key={file.key}
                file={file}
                shareId={shareId}
                selected={selected.has(file.key)}
                allowSelect={mode === 'download'}
                onToggle={toggle}
                isLast={i === filtered.length - 1}
              />
            ))}
          </div>
        )}

        {/* ── Grid view ──────────────────────────────────────────────── */}
        {!loading && !error && viewMode === 'grid' && filtered.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {filtered.map((file) => (
              <GridCard
                key={file.key}
                file={file}
                shareId={shareId}
                selected={selected.has(file.key)}
                allowSelect={mode === 'download'}
                onToggle={toggle}
                onPreview={setLightboxFile}
              />
            ))}
          </div>
        )}
      </main>

      <footer className="border-t border-gray-200 py-3 text-center">
        <p className="text-xs text-gray-400">
          {mode === 'preview'
            ? 'This folder is shared for preview only — downloads are disabled'
            : `Shared by ${folderName}`}
        </p>
      </footer>

      {/* ── Lightbox ──────────────────────────────────────────────────────────── */}
      {lightboxFile && (
        <div
          className="fixed inset-0 z-[9999] bg-black/95 flex items-center justify-center"
          onClick={() => setLightboxFile(null)}
        >
          <div
            className="relative w-full h-full flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setLightboxFile(null)}
              className="absolute top-4 right-4 z-10 w-9 h-9 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center text-xl transition-colors"
            >
              ✕
            </button>
            {/* Filename */}
            <div className="absolute top-4 left-4 z-10 text-white/60 text-sm truncate max-w-[80%] select-none">
              {displayName(lightboxFile.filename)}
            </div>
            {/* Protected viewer: canvas + watermark + blur-on-tab-switch */}
            <div className="w-full h-full flex items-center justify-center">
              <ProtectedImageViewer
                shareId={shareId}
                watermarkText="Preview only"
                fileUrl={`/api/share/${shareId}/img-preview?key=${encodeURIComponent(lightboxFile.key)}&sz=${lightboxFile.size}`}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── List row with mini-thumbnail ──────────────────────────────────────────────
function ListRow({
  file,
  shareId,
  selected,
  allowSelect,
  onToggle,
  isLast,
}: {
  file: FileItem;
  shareId: string;
  selected: boolean;
  allowSelect: boolean;
  onToggle: (key: string) => void;
  isLast: boolean;
}) {
  const url = getThumbUrl(file, shareId);

  return (
    <div
      onClick={() => allowSelect && onToggle(file.key)}
      className={`flex items-center gap-3 px-4 py-2 transition-colors ${
        allowSelect ? 'cursor-pointer' : ''
      } ${selected ? 'bg-blue-50' : 'hover:bg-gray-50'} ${
        !isLast ? 'border-b border-gray-50' : ''
      }`}
    >
      {allowSelect && (
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(file.key)}
          onClick={(e) => e.stopPropagation()}
          className="w-4 h-4 accent-blue-600 flex-shrink-0 cursor-pointer"
        />
      )}

      {/* Mini thumbnail or icon */}
      <div className="w-10 h-8 rounded flex-shrink-0 overflow-hidden bg-gray-100 flex items-center justify-center">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt=""
            loading="lazy"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-base">{fileIcon(file)}</span>
        )}
      </div>

      <span className="text-sm font-medium text-gray-800 flex-1 min-w-0 truncate">
        {displayName(file.filename)}
      </span>

      {file.isRaw && (
        <span className="text-[10px] font-bold bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded flex-shrink-0">
          RAW
        </span>
      )}

      <span className="text-xs text-gray-400 flex-shrink-0 w-14 text-right uppercase">
        {file.ext}
      </span>
      <span className="text-xs text-gray-500 flex-shrink-0 w-16 text-right">
        {formatSize(file.size)}
      </span>
    </div>
  );
}

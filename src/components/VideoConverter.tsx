'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// ─── Types ────────────────────────────────────────────────────────────────────

const QUALITY_PRESETS = [
  {
    id: '720p' as const,
    label: '720p',
    desc: 'HD — fast',
    bitrateMbps: 1.5,
    args: ['-vf', 'scale=-2:720', '-crf', '23', '-preset', 'fast'],
  },
  {
    id: '1080p' as const,
    label: '1080p',
    desc: 'Full HD — balanced',
    bitrateMbps: 4,
    args: ['-vf', 'scale=-2:1080', '-crf', '20', '-preset', 'fast'],
  },
  {
    id: '4k' as const,
    label: '4K',
    desc: 'Ultra HD — max',
    bitrateMbps: 15,
    args: ['-vf', 'scale=-2:2160', '-crf', '18', '-preset', 'medium'],
  },
  {
    id: 'original' as const,
    label: 'Original',
    desc: 'Keep resolution',
    bitrateMbps: 6,
    args: ['-crf', '20', '-preset', 'fast'],
  },
] as const;

type QualityPresetId = (typeof QUALITY_PRESETS)[number]['id'];

const REELS_ARGS = [
  '-vf',
  'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2',
  '-crf', '22',
  '-preset', 'fast',
];

interface QueueItem {
  id: string;
  file: File;
  qualityPreset: QualityPresetId;
  isReels: boolean;
  status: 'pending' | 'converting' | 'done' | 'error';
  progress: number;
  outputUrl?: string;
  outputSize?: number;
  outputName?: string;
  error?: string;
  duration?: number;
  saveStatus?: 'saving' | 'saved' | 'error';
  saveError?: string;
  elapsed?: number;
  eta?: number | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCEPTED_EXTS = ['.mov', '.hevc', '.mp4', '.avi', '.mkv', '.webm', '.m4v'];
const ACCEPTED_MIME = [
  'video/quicktime', 'video/mp4', 'video/x-msvideo',
  'video/x-matroska', 'video/webm', 'video/x-m4v',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatTime(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${s}s`;
}

function estimateSize(durationSeconds: number | undefined, presetId: QualityPresetId, isReels: boolean): string | null {
  if (!durationSeconds) return null;
  const bitrateMbps = isReels
    ? 3.5
    : QUALITY_PRESETS.find(p => p.id === presetId)!.bitrateMbps;
  const bytes = (bitrateMbps * 1_000_000 / 8) * durationSeconds;
  return `~${formatBytes(bytes)}`;
}

function buildFFmpegArgs(item: QueueItem, inputName: string, outputName: string): string[] {
  const extraArgs = item.isReels
    ? REELS_ARGS
    : [...QUALITY_PRESETS.find(p => p.id === item.qualityPreset)!.args];

  return [
    '-i', inputName,
    '-vcodec', 'libx264',
    '-acodec', 'aac',
    ...extraArgs,
    '-movflags', '+faststart',
    outputName,
  ];
}

function isVideoFile(file: File): boolean {
  const ext = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '');
  return ACCEPTED_EXTS.includes(ext) || ACCEPTED_MIME.includes(file.type);
}

function getFileDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(video.duration); };
    video.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
    video.src = url;
  });
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function VideoConverter() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [ffmpegStatus, setFfmpegStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [isConverting, setIsConverting] = useState(false);

  const [defaultPreset, setDefaultPreset] = useState<QualityPresetId>('1080p');
  const [defaultReels, setDefaultReels] = useState(false);

  const [folders, setFolders] = useState<string[]>([]);
  const [selectedFolder, setSelectedFolder] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const startTimeRef = useRef<number>(0);
  // Single progress callback ref — avoids stacking listeners on ffmpeg
  const progressCb = useRef<((p: number, elapsed: number, eta: number | null) => void) | null>(null);

  // Create FFmpeg instance and load WASM (browser only — ssr: false guarantees this)
  useEffect(() => {
    const instance = new FFmpeg();
    ffmpegRef.current = instance;

    instance.on('progress', ({ progress }) => {
      const pct = Math.min(99, Math.round(progress * 100));
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      const eta = progress > 0.02 ? Math.max(0, elapsed / progress - elapsed) : null;
      progressCb.current?.(pct, elapsed, eta);
    });

    // toBlobURL converts same-origin files to blob: URLs — bypasses COEP for WASM
    (async () => {
      console.log('[FFmpeg] Starting load...');
      try {
        const coreURL = await toBlobURL('/ffmpeg/ffmpeg-core.js', 'text/javascript');
        const wasmURL = await toBlobURL('/ffmpeg/ffmpeg-core.wasm', 'application/wasm');
        await instance.load({ coreURL, wasmURL });
        console.log('[FFmpeg] Loaded successfully');
        setFfmpegStatus('ready');
      } catch (err) {
        console.error('[FFmpeg] Load failed:', err);
        setLoadError(String(err));
        setFfmpegStatus('error');
      }
    })();
  }, []);

  // Load folders (also detects auth)
  useEffect(() => {
    fetch('/api/folders')
      .then(async (r) => {
        if (!r.ok) return;
        const data = await r.json();
        setFolders(data.folders ?? []);
        setIsAuthenticated(true);
      })
      .catch(() => {});
  }, []);

  const addFiles = useCallback(async (files: File[]) => {
    const valid = files.filter(isVideoFile);
    if (!valid.length) return;

    const newItems: QueueItem[] = valid.map((f) => ({
      id: `${Date.now()}-${Math.random()}`,
      file: f,
      qualityPreset: defaultPreset,
      isReels: defaultReels,
      status: 'pending',
      progress: 0,
    }));

    setQueue((prev) => [...prev, ...newItems]);

    // Resolve durations in parallel after adding
    const durations = await Promise.all(newItems.map((i) => getFileDuration(i.file)));
    setQueue((prev) =>
      prev.map((q) => {
        const idx = newItems.findIndex((i) => i.id === q.id);
        return idx >= 0 ? { ...q, duration: durations[idx] } : q;
      })
    );
  }, [defaultPreset, defaultReels]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  }, [addFiles]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files ?? []));
    e.target.value = '';
  }, [addFiles]);

  const convertItem = useCallback(async (item: QueueItem) => {
    const inputName = `input_${item.id}`;
    const outputName = item.file.name.replace(/\.[^.]+$/, '') + '_converted.mp4';

    setQueue((prev) => prev.map((q) => q.id === item.id ? { ...q, status: 'converting', progress: 0, elapsed: 0, eta: null } : q));

    progressCb.current = (p, elapsed, eta) =>
      setQueue((prev) => prev.map((q) => q.id === item.id ? { ...q, progress: p, elapsed, eta } : q));

    const ff = ffmpegRef.current!;
    try {
      await ff.writeFile(inputName, await fetchFile(item.file));
      startTimeRef.current = Date.now();
      await ff.exec(buildFFmpegArgs(item, inputName, outputName));

      const data = await ff.readFile(outputName);
      const blob = new Blob([data as unknown as BlobPart], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);

      await ff.deleteFile(inputName);
      await ff.deleteFile(outputName);

      setQueue((prev) => prev.map((q) =>
        q.id === item.id
          ? { ...q, status: 'done', progress: 100, outputUrl: url, outputSize: blob.size, outputName }
          : q
      ));
    } catch (err) {
      setQueue((prev) => prev.map((q) =>
        q.id === item.id
          ? { ...q, status: 'error', error: err instanceof Error ? err.message : 'Conversion failed' }
          : q
      ));
    } finally {
      progressCb.current = null;
    }
  }, []);

  const startConvert = useCallback(async () => {
    if (ffmpegStatus !== 'ready' || isConverting) return;
    const pending = queue.filter((q) => q.status === 'pending');
    if (!pending.length) return;

    setIsConverting(true);
    for (const item of pending) {
      await convertItem(item);
    }
    setIsConverting(false);
  }, [queue, ffmpegStatus, isConverting, convertItem]);

  const removeItem = useCallback((id: string) => {
    setQueue((prev) => {
      const item = prev.find((q) => q.id === id);
      if (item?.outputUrl) URL.revokeObjectURL(item.outputUrl);
      return prev.filter((q) => q.id !== id);
    });
  }, []);

  const updateItem = useCallback(<K extends keyof QueueItem>(id: string, key: K, value: QueueItem[K]) => {
    setQueue((prev) => prev.map((q) => q.id === id ? { ...q, [key]: value } : q));
  }, []);

  const handleSaveToGallery = useCallback(async (item: QueueItem) => {
    if (!item.outputUrl || !item.outputName) return;

    setQueue((prev) => prev.map((q) => q.id === item.id ? { ...q, saveStatus: 'saving' } : q));

    try {
      const folder = selectedFolder || 'uncategorized';

      // 1. Get presigned URL
      const presignRes = await fetch('/api/upload/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: item.outputName, contentType: 'video/mp4', folder }),
      });
      if (!presignRes.ok) throw new Error('Failed to get upload URL');
      const { signedUrl, key } = await presignRes.json() as { signedUrl: string; key: string };

      // 2. Fetch blob from memory URL and upload directly to R2
      const blobRes = await fetch(item.outputUrl);
      const blob = await blobRes.blob();

      const uploadRes = await fetch(signedUrl, {
        method: 'PUT',
        body: blob,
        headers: { 'Content-Type': 'video/mp4' },
      });
      if (!uploadRes.ok) throw new Error('Upload to storage failed');

      // 3. Save metadata
      const metaRes = await fetch('/api/upload/metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key,
          filename: item.outputName,
          contentType: 'video/mp4',
          size: item.outputSize ?? 0,
          folder,
        }),
      });
      if (!metaRes.ok) throw new Error('Failed to save metadata');

      setQueue((prev) => prev.map((q) => q.id === item.id ? { ...q, saveStatus: 'saved' } : q));
    } catch (err) {
      setQueue((prev) => prev.map((q) =>
        q.id === item.id
          ? { ...q, saveStatus: 'error', saveError: err instanceof Error ? err.message : 'Save failed' }
          : q
      ));
    }
  }, [selectedFolder]);

  const pendingCount = queue.filter((q) => q.status === 'pending').length;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <a href="/" className="text-gray-400 hover:text-gray-200 transition-colors text-sm flex items-center gap-1">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
            Back
          </a>
          <span className="text-gray-700">|</span>
          <h1 className="text-sm font-medium text-gray-200">Video Converter</h1>
        </div>
        <FFmpegStatusBadge status={ffmpegStatus} />
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">

        {/* FFmpeg load error */}
        {ffmpegStatus === 'error' && (
          <div className="text-red-400 text-center py-10">
            <p className="text-2xl mb-2">❌</p>
            <p className="text-sm">{loadError || 'Failed to load FFmpeg.'}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-3 text-sm underline hover:text-red-300 transition-colors"
            >
              Refresh page
            </button>
          </div>
        )}

        {/* Output Settings */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-300">Output Settings</h2>

          {/* Quality preset tabs */}
          <div className="grid grid-cols-4 gap-2">
            {QUALITY_PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => setDefaultPreset(p.id)}
                className={`
                  rounded-lg px-3 py-2.5 text-left transition-colors border
                  ${defaultPreset === p.id && !defaultReels
                    ? 'border-blue-500 bg-blue-500/10 text-blue-300'
                    : 'border-gray-700 hover:border-gray-600 text-gray-400 hover:text-gray-300'
                  }
                `}
              >
                <div className="text-sm font-semibold">{p.label}</div>
                <div className="text-xs mt-0.5 opacity-70">{p.desc}</div>
              </button>
            ))}
          </div>

          {/* Instagram Reels button */}
          <button
            onClick={() => setDefaultReels((v) => !v)}
            className={`
              w-full flex items-center justify-between rounded-lg px-4 py-2.5 border transition-colors text-sm
              ${defaultReels
                ? 'border-pink-500 bg-pink-500/10 text-pink-300'
                : 'border-gray-700 hover:border-gray-600 text-gray-400 hover:text-gray-300'
              }
            `}
          >
            <span>📱 Instagram Reels — 1080×1920, CRF 22</span>
            {defaultReels && <span className="text-xs bg-pink-500/20 px-2 py-0.5 rounded-full">ON</span>}
          </button>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`
            border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors
            ${isDragging
              ? 'border-blue-500 bg-blue-500/5'
              : 'border-gray-700 hover:border-blue-500 hover:bg-gray-800/40'
            }
          `}
        >
          <div className="flex flex-col items-center gap-3 pointer-events-none">
            <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-500">
              <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
            </svg>
            <div>
              <p className="text-sm font-medium text-gray-300">Drop videos here or click to browse</p>
              <p className="text-xs text-gray-500 mt-1">{ACCEPTED_EXTS.join(', ')}</p>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_EXTS.join(',')}
            multiple
            onChange={handleFileInput}
            className="hidden"
          />
        </div>

        {/* Queue */}
        {queue.length > 0 && (
          <div className="space-y-3">
            {queue.map((item) => (
              <QueueCard
                key={item.id}
                item={item}
                onRemove={removeItem}
                onUpdate={updateItem}
                folders={folders}
                selectedFolder={selectedFolder}
                onFolderChange={setSelectedFolder}
                onSave={handleSaveToGallery}
                isAuthenticated={isAuthenticated}
              />
            ))}
          </div>
        )}

        {/* Convert button */}
        {pendingCount > 0 && (
          <button
            onClick={startConvert}
            disabled={ffmpegStatus !== 'ready' || isConverting}
            className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-medium transition-colors text-sm"
          >
            {isConverting
              ? 'Converting…'
              : `Convert ${pendingCount} file${pendingCount > 1 ? 's' : ''} to MP4`}
          </button>
        )}

        {queue.length === 0 && (
          <p className="text-center text-xs text-gray-600">
            All conversion happens in your browser — no upload, fully private.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── FFmpeg Status Badge ──────────────────────────────────────────────────────

function FFmpegStatusBadge({ status }: { status: 'loading' | 'ready' | 'error' }) {
  if (status === 'loading')
    return <span className="text-xs text-yellow-400 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse inline-block" />Loading FFmpeg…</span>;
  if (status === 'ready')
    return <span className="text-xs text-green-400 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />FFmpeg ready</span>;
  return <span className="text-xs text-red-400">FFmpeg failed to load</span>;
}

// ─── Queue Card ───────────────────────────────────────────────────────────────

interface QueueCardProps {
  item: QueueItem;
  onRemove: (id: string) => void;
  onUpdate: <K extends keyof QueueItem>(id: string, key: K, value: QueueItem[K]) => void;
  folders: string[];
  selectedFolder: string;
  onFolderChange: (f: string) => void;
  onSave: (item: QueueItem) => void;
  isAuthenticated: boolean;
}

function QueueCard({ item, onRemove, onUpdate, folders, selectedFolder, onFolderChange, onSave, isAuthenticated }: QueueCardProps) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
      {/* File info */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-200 truncate">{item.file.name}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {formatBytes(item.file.size)}
            {item.duration ? ` · ${formatDuration(item.duration)}` : ''}
          </p>
        </div>
        {item.status !== 'converting' && (
          <button
            onClick={() => onRemove(item.id)}
            className="text-gray-600 hover:text-red-400 transition-colors flex-shrink-0"
            title="Remove"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        )}
      </div>

      {/* Per-file preset selector (pending only) */}
      {item.status === 'pending' && (
        <div className="space-y-2">
          <div className="grid grid-cols-4 gap-1.5">
            {QUALITY_PRESETS.map((p) => {
              const est = estimateSize(item.duration, p.id, false);
              return (
                <button
                  key={p.id}
                  onClick={() => { onUpdate(item.id, 'qualityPreset', p.id); onUpdate(item.id, 'isReels', false); }}
                  className={`
                    rounded-lg px-2 py-2 text-left transition-colors border text-xs
                    ${item.qualityPreset === p.id && !item.isReels
                      ? 'border-blue-500 bg-blue-500/10 text-blue-300'
                      : 'border-gray-700 hover:border-gray-600 text-gray-400'
                    }
                  `}
                >
                  <div className="font-semibold">{p.label}</div>
                  {est && <div className="opacity-60 mt-0.5">{est}</div>}
                </button>
              );
            })}
          </div>
          <button
            onClick={() => onUpdate(item.id, 'isReels', !item.isReels)}
            className={`
              w-full text-left rounded-lg px-3 py-1.5 border transition-colors text-xs
              ${item.isReels
                ? 'border-pink-500 bg-pink-500/10 text-pink-300'
                : 'border-gray-700 hover:border-gray-600 text-gray-500'
              }
            `}
          >
            📱 Instagram Reels 1080×1920
            {item.isReels && (
              <span className="ml-2 text-xs opacity-70">
                {estimateSize(item.duration, '1080p', true) ?? ''}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Progress */}
      {item.status === 'converting' && (
        <div className="space-y-2">
          <div className="w-full bg-gray-700 rounded-full h-2.5 overflow-hidden">
            <div
              className="bg-blue-500 h-2.5 rounded-full transition-all duration-300"
              style={{ width: `${item.progress}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-400">
            <span>⚙️ Converting… {item.progress}%</span>
            <span className="flex gap-3">
              {item.elapsed !== undefined && item.elapsed > 0 && (
                <span>⏱ {formatTime(item.elapsed)}</span>
              )}
              {item.eta != null && (
                <span>ETA: ~{formatTime(item.eta)}</span>
              )}
            </span>
          </div>
        </div>
      )}

      {/* Done */}
      {item.status === 'done' && item.outputUrl && (
        <div className="space-y-3 pt-1 border-t border-gray-800">
          <div className="flex items-center justify-between">
            <span className="text-xs text-green-400 font-medium">
              ✅ {item.outputName} {item.outputSize ? `(${formatBytes(item.outputSize)})` : ''}
            </span>
            <a
              href={item.outputUrl}
              download={item.outputName}
              className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Download MP4
            </a>
          </div>

          {/* Save to Gallery (only when authenticated) */}
          {isAuthenticated && item.saveStatus !== 'saved' && (
            <div className="flex items-center gap-2">
              <select
                value={selectedFolder}
                onChange={(e) => onFolderChange(e.target.value)}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-500 min-w-0"
              >
                <option value="">📁 All Files (root)</option>
                {folders.map((f) => (
                  <option key={f} value={f}>📁 {f}</option>
                ))}
              </select>
              <button
                onClick={() => onSave(item)}
                disabled={item.saveStatus === 'saving'}
                className="flex-shrink-0 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
              >
                {item.saveStatus === 'saving' ? 'Saving…' : '📁 Save to Gallery'}
              </button>
            </div>
          )}

          {item.saveStatus === 'saved' && (
            <p className="text-xs text-green-400">✅ Saved to gallery</p>
          )}
          {item.saveStatus === 'error' && (
            <p className="text-xs text-red-400">{item.saveError}</p>
          )}
        </div>
      )}

      {/* Error */}
      {item.status === 'error' && (
        <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{item.error}</p>
      )}
    </div>
  );
}

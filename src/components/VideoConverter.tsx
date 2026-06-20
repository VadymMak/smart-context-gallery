'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// ─── Types ────────────────────────────────────────────────────────────────────

type Quality = 'high' | 'medium' | 'small';
type Resolution = 'original' | '1080p' | '720p';
type Preset = 'none' | 'reels' | 'square';

interface QueueItem {
  id: string;
  file: File;
  quality: Quality;
  resolution: Resolution;
  preset: Preset;
  status: 'pending' | 'converting' | 'done' | 'error';
  progress: number;
  outputUrl?: string;
  outputSize?: number;
  outputName?: string;
  error?: string;
  duration?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCEPTED_EXTS = ['.mov', '.hevc', '.mp4', '.avi', '.mkv', '.webm', '.m4v'];
const ACCEPTED_MIME = [
  'video/quicktime', 'video/mp4', 'video/x-msvideo',
  'video/x-matroska', 'video/webm', 'video/x-m4v',
];

const CRF_MAP: Record<Quality, string> = {
  high: '18',
  medium: '23',
  small: '28',
};

const QUALITY_LABELS: Record<Quality, string> = {
  high: 'High (CRF 18)',
  medium: 'Medium (CRF 23)',
  small: 'Small (CRF 28)',
};

const RESOLUTION_LABELS: Record<Resolution, string> = {
  original: 'Original',
  '1080p': '1080p',
  '720p': '720p',
};

const PRESET_LABELS: Record<Preset, string> = {
  none: 'None',
  reels: 'Instagram Reels (1080×1920)',
  square: 'Instagram Square (1080×1080)',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function buildVfFilter(resolution: Resolution, preset: Preset): string[] {
  if (preset === 'reels') return ['-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2'];
  if (preset === 'square') return ['-vf', 'scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2'];
  if (resolution === '1080p') return ['-vf', 'scale=-2:1080'];
  if (resolution === '720p') return ['-vf', 'scale=-2:720'];
  return [];
}

function isVideoFile(file: File): boolean {
  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  return ACCEPTED_EXTS.includes(ext) || ACCEPTED_MIME.includes(file.type);
}

// ─── FFmpeg singleton ─────────────────────────────────────────────────────────

const ffmpeg = new FFmpeg();
let ffmpegLoaded = false;
let ffmpegLoading = false;

async function loadFFmpeg(onLog?: (msg: string) => void) {
  if (ffmpegLoaded) return;
  if (ffmpegLoading) {
    // wait for other call
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (ffmpegLoaded) { clearInterval(check); resolve(); }
      }, 100);
    });
    return;
  }
  ffmpegLoading = true;
  if (onLog) ffmpeg.on('log', ({ message }) => onLog(message));
  const base = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  ffmpegLoaded = true;
  ffmpegLoading = false;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function VideoConverter() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [ffmpegStatus, setFfmpegStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [isConverting, setIsConverting] = useState(false);

  // Default settings (per-file overrideable)
  const [defaultQuality, setDefaultQuality] = useState<Quality>('medium');
  const [defaultResolution, setDefaultResolution] = useState<Resolution>('original');
  const [defaultPreset, setDefaultPreset] = useState<Preset>('none');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Preload FFmpeg on mount
  useEffect(() => {
    setFfmpegStatus('loading');
    loadFFmpeg()
      .then(() => setFfmpegStatus('ready'))
      .catch(() => setFfmpegStatus('error'));
  }, []);

  const addFiles = useCallback((files: File[]) => {
    const valid = files.filter(isVideoFile);
    if (!valid.length) return;
    setQueue((prev) => [
      ...prev,
      ...valid.map((f) => ({
        id: `${Date.now()}-${Math.random()}`,
        file: f,
        quality: defaultQuality,
        resolution: defaultResolution,
        preset: defaultPreset,
        status: 'pending' as const,
        progress: 0,
      })),
    ]);
  }, [defaultQuality, defaultResolution, defaultPreset]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    addFiles(files);
  }, [addFiles]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    addFiles(files);
    e.target.value = '';
  }, [addFiles]);

  const getFileDuration = useCallback((file: File): Promise<number> => {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(video.duration);
      };
      video.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
      video.src = url;
    });
  }, []);

  const convertItem = useCallback(async (item: QueueItem) => {
    const inputName = `input_${item.id}.mov`;
    const outputName = item.file.name.replace(/\.[^.]+$/, '') + '_converted.mp4';

    setQueue((prev) => prev.map((q) => q.id === item.id ? { ...q, status: 'converting', progress: 0 } : q));

    ffmpeg.on('progress', ({ progress }) => {
      setQueue((prev) => prev.map((q) =>
        q.id === item.id ? { ...q, progress: Math.min(99, Math.round(progress * 100)) } : q
      ));
    });

    try {
      await ffmpeg.writeFile(inputName, await fetchFile(item.file));

      const vfArgs = buildVfFilter(item.resolution, item.preset);
      await ffmpeg.exec([
        '-i', inputName,
        '-vcodec', 'libx264',
        '-acodec', 'aac',
        '-crf', CRF_MAP[item.quality],
        '-preset', 'fast',
        ...vfArgs,
        '-movflags', '+faststart',
        outputName,
      ]);

      const data = await ffmpeg.readFile(outputName);
      // FFmpeg returns Uint8Array<ArrayBufferLike>; Blob constructor needs ArrayBuffer
      const blob = new Blob([data as unknown as BlobPart], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);

      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile(outputName);

      setQueue((prev) => prev.map((q) =>
        q.id === item.id
          ? { ...q, status: 'done', progress: 100, outputUrl: url, outputSize: blob.size, outputName }
          : q
      ));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Conversion failed';
      setQueue((prev) => prev.map((q) =>
        q.id === item.id ? { ...q, status: 'error', error: msg } : q
      ));
    }
  }, []);

  const startConvert = useCallback(async () => {
    if (ffmpegStatus !== 'ready' || isConverting) return;
    const pending = queue.filter((q) => q.status === 'pending');
    if (!pending.length) return;

    setIsConverting(true);
    for (const item of pending) {
      // Resolve duration before converting
      const duration = await getFileDuration(item.file);
      setQueue((prev) => prev.map((q) => q.id === item.id ? { ...q, duration } : q));
      await convertItem(item);
    }
    setIsConverting(false);
  }, [queue, ffmpegStatus, isConverting, convertItem, getFileDuration]);

  const removeItem = useCallback((id: string) => {
    setQueue((prev) => {
      const item = prev.find((q) => q.id === id);
      if (item?.outputUrl) URL.revokeObjectURL(item.outputUrl);
      return prev.filter((q) => q.id !== id);
    });
  }, []);

  const updateItemSetting = useCallback(<K extends keyof QueueItem>(id: string, key: K, value: QueueItem[K]) => {
    setQueue((prev) => prev.map((q) => q.id === id ? { ...q, [key]: value } : q));
  }, []);

  const pendingCount = queue.filter((q) => q.status === 'pending').length;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a href="/" className="text-gray-400 hover:text-gray-200 transition-colors text-sm flex items-center gap-1">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
            Back
          </a>
          <span className="text-gray-600">|</span>
          <h1 className="text-sm font-medium text-gray-200">Video Converter</h1>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {ffmpegStatus === 'loading' && (
            <span className="text-yellow-400 flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
              Loading FFmpeg…
            </span>
          )}
          {ffmpegStatus === 'ready' && (
            <span className="text-green-400 flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-green-400" />
              FFmpeg ready
            </span>
          )}
          {ffmpegStatus === 'error' && (
            <span className="text-red-400">FFmpeg failed to load</span>
          )}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">

        {/* Default settings */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Default Settings for New Files</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="space-y-1">
              <span className="text-xs text-gray-400">Quality</span>
              <select
                value={defaultQuality}
                onChange={(e) => setDefaultQuality(e.target.value as Quality)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
              >
                {(Object.keys(QUALITY_LABELS) as Quality[]).map((k) => (
                  <option key={k} value={k}>{QUALITY_LABELS[k]}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-gray-400">Resolution</span>
              <select
                value={defaultResolution}
                onChange={(e) => setDefaultResolution(e.target.value as Resolution)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
              >
                {(Object.keys(RESOLUTION_LABELS) as Resolution[]).map((k) => (
                  <option key={k} value={k}>{RESOLUTION_LABELS[k]}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-gray-400">Instagram Preset</span>
              <select
                value={defaultPreset}
                onChange={(e) => setDefaultPreset(e.target.value as Preset)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
              >
                {(Object.keys(PRESET_LABELS) as Preset[]).map((k) => (
                  <option key={k} value={k}>{PRESET_LABELS[k]}</option>
                ))}
              </select>
            </label>
          </div>
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
              : 'border-gray-700 hover:border-blue-500 hover:bg-gray-800/50'
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
                onUpdate={updateItemSetting}
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
              : `Convert ${pendingCount} file${pendingCount > 1 ? 's' : ''} to MP4`
            }
          </button>
        )}

        {/* Empty state */}
        {queue.length === 0 && (
          <p className="text-center text-xs text-gray-600">
            All conversion happens in your browser — no upload, no server, fully private.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Queue Card ───────────────────────────────────────────────────────────────

interface QueueCardProps {
  item: QueueItem;
  onRemove: (id: string) => void;
  onUpdate: <K extends keyof QueueItem>(id: string, key: K, value: QueueItem[K]) => void;
}

function QueueCard({ item, onRemove, onUpdate }: QueueCardProps) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
      {/* File info row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-200 truncate">{item.file.name}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {formatBytes(item.file.size)}
            {item.duration ? ` · ${formatDuration(item.duration)}` : ''}
          </p>
        </div>
        <button
          onClick={() => onRemove(item.id)}
          className="text-gray-600 hover:text-red-400 transition-colors flex-shrink-0 mt-0.5"
          title="Remove"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      {/* Per-file settings (only when pending) */}
      {item.status === 'pending' && (
        <div className="grid grid-cols-3 gap-2">
          <select
            value={item.quality}
            onChange={(e) => onUpdate(item.id, 'quality', e.target.value as Quality)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
          >
            {(Object.keys(QUALITY_LABELS) as Quality[]).map((k) => (
              <option key={k} value={k}>{QUALITY_LABELS[k]}</option>
            ))}
          </select>
          <select
            value={item.resolution}
            onChange={(e) => onUpdate(item.id, 'resolution', e.target.value as Resolution)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
          >
            {(Object.keys(RESOLUTION_LABELS) as Resolution[]).map((k) => (
              <option key={k} value={k}>{RESOLUTION_LABELS[k]}</option>
            ))}
          </select>
          <select
            value={item.preset}
            onChange={(e) => onUpdate(item.id, 'preset', e.target.value as Preset)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
          >
            {(Object.keys(PRESET_LABELS) as Preset[]).map((k) => (
              <option key={k} value={k}>{PRESET_LABELS[k]}</option>
            ))}
          </select>
        </div>
      )}

      {/* Progress */}
      {item.status === 'converting' && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-gray-400">
            <span>Converting…</span>
            <span>{item.progress}%</span>
          </div>
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 rounded-full transition-all duration-300"
              style={{ width: `${item.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Done */}
      {item.status === 'done' && item.outputUrl && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-green-400">
            Done · {item.outputSize ? formatBytes(item.outputSize) : ''}
          </span>
          <a
            href={item.outputUrl}
            download={item.outputName}
            className="text-xs bg-green-600 hover:bg-green-500 text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            Download MP4
          </a>
        </div>
      )}

      {/* Error */}
      {item.status === 'error' && (
        <p className="text-xs text-red-400">{item.error}</p>
      )}
    </div>
  );
}

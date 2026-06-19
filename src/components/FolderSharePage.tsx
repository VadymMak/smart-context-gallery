'use client';

import { useState } from 'react';
import type { Share } from '@/lib/shares';
import type { FolderFile } from '@/lib/r2';

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'heic', 'avif']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm']);

function getFileType(filename: string): 'image' | 'video' | 'pdf' | 'document' {
  const ext = filename.toLowerCase().split('.').pop() || '';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (ext === 'pdf') return 'pdf';
  return 'document';
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function FileIcon({ type }: { type: 'image' | 'video' | 'pdf' | 'document' }) {
  if (type === 'video') {
    return (
      <svg className="w-10 h-10 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
      </svg>
    );
  }
  if (type === 'pdf') {
    return (
      <svg className="w-10 h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    );
  }
  return (
    <svg className="w-10 h-10 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function FileCard({ file, shareId }: { file: FolderFile; shareId: string }) {
  const type = getFileType(file.filename);
  const isImage = type === 'image';
  const [imgError, setImgError] = useState(false);

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden shadow-sm hover:shadow-md transition-shadow group">
      {/* Thumbnail */}
      <div className="aspect-square bg-gray-50 flex items-center justify-center overflow-hidden relative">
        {isImage && !imgError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/share/${shareId}/folder-file?key=${encodeURIComponent(file.key)}`}
            alt={file.filename}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <FileIcon type={type} />
        )}
      </div>

      {/* Info */}
      <div className="p-2.5">
        <p className="text-xs font-medium text-gray-800 truncate" title={file.filename}>
          {file.filename}
        </p>
        <p className="text-xs text-gray-400 mt-0.5">{formatBytes(file.size)}</p>
      </div>
    </div>
  );
}

interface Props {
  share: Share;
  files: FolderFile[];
}

export function FolderSharePage({ share, files }: Props) {
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-500">
            <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          <span className="font-semibold text-sm text-gray-800">AK Storage</span>
        </div>
        {share.mode === 'preview' ? (
          <span className="flex items-center gap-1.5 px-2.5 py-1 bg-purple-100 text-purple-700 text-xs rounded-full font-medium">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            Preview only
          </span>
        ) : (
          <span className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-100 text-blue-700 text-xs rounded-full font-medium">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
            </svg>
            Download enabled
          </span>
        )}
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Folder header */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-end gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-yellow-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-7 h-7 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
                <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{share.fileName}</h1>
              <p className="text-sm text-gray-500">
                {files.length} {files.length === 1 ? 'file' : 'files'} · {formatBytes(totalSize)} · Shared by {share.createdByName}
              </p>
            </div>
          </div>
        </div>

        {/* Empty state */}
        {files.length === 0 && (
          <div className="text-center py-20 text-gray-400">
            <svg className="w-16 h-16 mx-auto mb-4 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <p className="text-sm">This folder is empty</p>
          </div>
        )}

        {/* File grid */}
        {files.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {files.map((file) => (
              <FileCard key={file.key} file={file} shareId={share.id} />
            ))}
          </div>
        )}
      </main>

      <footer className="border-t border-gray-200 px-6 py-3 text-center">
        <p className="text-xs text-gray-400">
          {share.mode === 'preview' ? 'This folder is shared for preview only' : `Folder shared by ${share.createdByName}`}
        </p>
      </footer>
    </div>
  );
}

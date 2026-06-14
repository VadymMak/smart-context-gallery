'use client';

import { useState } from 'react';
import type { GalleryImage } from '@/lib/r2';

interface Props {
  file: GalleryImage;
  onClose: () => void;
}

type ShareMode = 'download' | 'preview';

export function ShareModal({ file, onClose }: Props) {
  const [mode, setMode] = useState<ShareMode>('download');
  const [shareUrl, setShareUrl] = useState('');
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    setCreating(true);
    setError('');
    try {
      const res = await fetch('/api/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileKey: file.key, mode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to create link');
        return;
      }
      setShareUrl(data.url);
    } catch {
      setError('Network error');
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const fileName = file.filename;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-1">Share &quot;{fileName}&quot;</h3>
        <p className="text-xs text-gray-400 mb-5">Choose how recipients can access this file</p>

        {/* Mode selector */}
        <div className="space-y-3 mb-5">
          <label
            className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${mode === 'download' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
          >
            <input
              type="radio"
              name="mode"
              value="download"
              checked={mode === 'download'}
              onChange={() => { setMode('download'); setShareUrl(''); }}
              className="mt-0.5 accent-blue-600"
            />
            <div>
              <p className="text-sm font-medium text-gray-800">Download link</p>
              <p className="text-xs text-gray-500 mt-0.5">Anyone with the link can download the original file</p>
            </div>
          </label>

          <label
            className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${mode === 'preview' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
          >
            <input
              type="radio"
              name="mode"
              value="preview"
              checked={mode === 'preview'}
              onChange={() => { setMode('preview'); setShareUrl(''); }}
              className="mt-0.5 accent-blue-600"
            />
            <div>
              <p className="text-sm font-medium text-gray-800">Preview only</p>
              <p className="text-xs text-gray-500 mt-0.5">View in browser with watermark, download disabled</p>
            </div>
          </label>
        </div>

        {/* Generated URL */}
        {shareUrl && (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 mb-5">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={shareUrl}
                readOnly
                className="flex-1 bg-transparent text-sm text-gray-700 outline-none min-w-0 truncate"
              />
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 shrink-0 transition-colors"
              >
                {copied ? (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    Copied!
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                    Copy
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 border border-gray-200 rounded-xl text-gray-700 hover:bg-gray-50 font-medium transition-colors text-sm"
          >
            {shareUrl ? 'Done' : 'Cancel'}
          </button>
          {!shareUrl && (
            <button
              onClick={handleCreate}
              disabled={creating}
              className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium disabled:opacity-50 transition-colors text-sm"
            >
              {creating ? 'Creating…' : 'Create Link'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

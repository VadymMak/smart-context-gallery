'use client';

import { useState } from 'react';
import type { GalleryImage } from '@/lib/r2';

interface Props {
  file: GalleryImage;
  onClose: () => void;
}

type ShareMode = 'download' | 'preview';

export function ShareModal({ file, onClose }: Props) {
  const [mode, setMode] = useState<ShareMode>('preview');
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

  const copyToClipboard = async (text: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        return;
      }
      // Fallback for mobile Safari and non-secure contexts
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      textArea.style.top = '-9999px';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        window.prompt('Copy this link:', text);
      }
      document.body.removeChild(textArea);
    } catch {
      window.prompt('Copy this link:', text);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-1">Share &quot;{file.filename}&quot;</h3>
        <p className="text-xs text-gray-400 mb-5">Choose how recipients can access this file</p>

        {/* Mode selector — button cards */}
        <div className="space-y-2 mb-5">
          <p className="text-sm font-medium text-gray-700">Sharing mode</p>

          <button
            onClick={() => { setMode('download'); setShareUrl(''); }}
            className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-colors ${
              mode === 'download' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <svg className="w-5 h-5 shrink-0 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
            </svg>
            <div>
              <div className="font-medium text-sm text-gray-800">Download link</div>
              <div className="text-xs text-gray-500">Anyone can view and download the original file</div>
            </div>
            {mode === 'download' && (
              <svg className="w-4 h-4 shrink-0 ml-auto text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>

          <button
            onClick={() => { setMode('preview'); setShareUrl(''); }}
            className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-colors ${
              mode === 'preview' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <svg className="w-5 h-5 shrink-0 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            <div>
              <div className="font-medium text-sm text-gray-800">Preview only</div>
              <div className="text-xs text-gray-500">View in browser with watermark, download blocked</div>
            </div>
            {mode === 'preview' && (
              <svg className="w-4 h-4 shrink-0 ml-auto text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>
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
                onClick={() => copyToClipboard(shareUrl)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 shrink-0 transition-colors"
              >
                {copied ? (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Copied!
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
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

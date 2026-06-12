'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { GalleryImage } from '@/lib/r2';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
  initialImages: GalleryImage[];
  initialFolders: string[];
}

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error';
}

// ─── Toast ───────────────────────────────────────────────────────────────────

function ToastList({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: number) => void }) {
  return (
    <div className="fixed bottom-6 right-6 flex flex-col gap-2 z-50">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`px-4 py-3 rounded-xl shadow-lg text-white text-sm font-medium flex items-center gap-2 animate-fadeIn ${
            t.type === 'success' ? 'bg-green-600' : 'bg-red-600'
          }`}
        >
          <span>{t.type === 'success' ? '✓' : '✕'}</span>
          {t.message}
          <button onClick={() => onRemove(t.id)} className="ml-2 opacity-70 hover:opacity-100">×</button>
        </div>
      ))}
    </div>
  );
}

// ─── Image Card ───────────────────────────────────────────────────────────────

function ImageCard({
  image,
  onDelete,
  onClick,
}: {
  image: GalleryImage;
  onDelete: (key: string) => void;
  onClick: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setDeleting(true);
    await onDelete(image.key);
    setDeleting(false);
    setConfirming(false);
  };

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirming(false);
  };

  return (
    <div
      className="group relative bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow cursor-pointer aspect-square"
      onClick={onClick}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.url}
        alt={image.filename}
        className="w-full h-full object-cover transition-transform group-hover:scale-105 duration-300"
        loading="lazy"
      />

      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-200" />

      {confirming ? (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 gap-2 p-3"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-white text-xs text-center font-medium">Delete this image?</p>
          <div className="flex gap-2">
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="px-3 py-1 bg-red-600 text-white text-xs rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? '...' : 'Delete'}
            </button>
            <button
              onClick={handleCancelDelete}
              className="px-3 py-1 bg-white/20 text-white text-xs rounded-lg hover:bg-white/30"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={handleDelete}
          className="absolute top-2 right-2 w-8 h-8 bg-black/50 hover:bg-red-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center text-sm"
          title="Delete image"
        >
          🗑
        </button>
      )}

      <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
        <p className="text-white text-xs truncate">{image.filename}</p>
      </div>
    </div>
  );
}

// ─── Lightbox ────────────────────────────────────────────────────────────────

function Lightbox({
  images,
  index,
  onClose,
  onPrev,
  onNext,
}: {
  images: GalleryImage[];
  index: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const image = images[index];

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onPrev();
      if (e.key === 'ArrowRight') onNext();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, onPrev, onNext]);

  if (!image) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center"
      onClick={onClose}
    >
      <button
        className="absolute top-4 right-4 w-10 h-10 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center text-xl transition-colors"
        onClick={onClose}
      >
        ×
      </button>

      {index > 0 && (
        <button
          className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center text-xl transition-colors"
          onClick={(e) => { e.stopPropagation(); onPrev(); }}
        >
          ‹
        </button>
      )}

      {index < images.length - 1 && (
        <button
          className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center text-xl transition-colors"
          onClick={(e) => { e.stopPropagation(); onNext(); }}
        >
          ›
        </button>
      )}

      <div
        className="max-w-5xl max-h-[80vh] w-full px-16"
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.url}
          alt={image.filename}
          className="max-w-full max-h-[75vh] object-contain mx-auto rounded-xl"
        />
      </div>

      <div className="mt-4 text-center">
        <p className="text-white/80 text-sm">{image.filename}</p>
        <p className="text-white/50 text-xs mt-1">
          {new Date(image.lastModified).toLocaleDateString()} · {index + 1}/{images.length}
        </p>
      </div>
    </div>
  );
}

// ─── Upload Modal ─────────────────────────────────────────────────────────────

function UploadModal({
  folders,
  onClose,
  onSuccess,
}: {
  folders: string[];
  onClose: () => void;
  onSuccess: (newFolders: string[]) => void;
}) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [folder, setFolder] = useState(folders[0] || 'uncategorized');
  const [newFolder, setNewFolder] = useState('');
  const [useNewFolder, setUseNewFolder] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeFolder = useNewFolder ? newFolder.trim() || 'uncategorized' : folder;

  const addFiles = (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
    setSelectedFiles((prev) => [...prev, ...imageFiles]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  const handleUpload = async () => {
    if (!selectedFiles.length) return;
    setUploading(true);
    setProgress('Uploading...');

    try {
      const formData = new FormData();
      selectedFiles.forEach((f) => formData.append('files', f));
      formData.append('folder', activeFolder);

      const res = await fetch('/api/images', { method: 'POST', body: formData });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Upload failed');
      }

      const updatedFoldersRes = await fetch('/api/folders');
      const { folders: newFolders } = await updatedFoldersRes.json();
      onSuccess(newFolders);
    } catch (err) {
      setProgress(err instanceof Error ? err.message : 'Upload failed');
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold">Upload Images</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors mb-4 ${
            dragging ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-400 hover:bg-gray-50'
          }`}
        >
          <div className="text-4xl mb-2">📁</div>
          <p className="text-gray-600 text-sm">
            Drag & drop images here, or <span className="text-blue-600 font-medium">browse files</span>
          </p>
          <p className="text-gray-400 text-xs mt-1">Max 10MB per file</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
        </div>

        {/* Preview thumbnails */}
        {selectedFiles.length > 0 && (
          <div className="flex gap-2 flex-wrap mb-4">
            {selectedFiles.map((f, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={URL.createObjectURL(f)}
                  alt={f.name}
                  className="w-16 h-16 object-cover rounded-lg border border-gray-200"
                />
                <button
                  onClick={() => setSelectedFiles((prev) => prev.filter((_, j) => j !== i))}
                  className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-xs flex items-center justify-center"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Folder selector */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Folder</label>
          <div className="flex gap-2 mb-2">
            <button
              onClick={() => setUseNewFolder(false)}
              className={`text-sm px-3 py-1 rounded-lg border transition-colors ${!useNewFolder ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
            >
              Existing
            </button>
            <button
              onClick={() => setUseNewFolder(true)}
              className={`text-sm px-3 py-1 rounded-lg border transition-colors ${useNewFolder ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
            >
              New folder
            </button>
          </div>

          {useNewFolder ? (
            <input
              type="text"
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
              placeholder="e.g. animals, portraits..."
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          ) : (
            <select
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="uncategorized">uncategorized</option>
              {folders.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          )}
        </div>

        {progress && (
          <p className={`text-sm mb-3 ${progress.includes('fail') || progress.includes('exceed') ? 'text-red-500' : 'text-gray-500'}`}>
            {progress}
          </p>
        )}

        <button
          onClick={handleUpload}
          disabled={!selectedFiles.length || uploading}
          className="w-full py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {uploading ? 'Uploading...' : `Upload ${selectedFiles.length ? `${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''}` : 'files'}`}
        </button>
      </div>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="aspect-square bg-gray-200 rounded-xl animate-pulse" />
      ))}
    </div>
  );
}

// ─── Main Gallery Client ───────────────────────────────────────────────────────

export function GalleryClient({ initialImages, initialFolders }: Props) {
  const [images, setImages] = useState<GalleryImage[]>(initialImages);
  const [folders, setFolders] = useState<string[]>(initialFolders);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);

  const addToast = useCallback((message: string, type: Toast['type']) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const fetchImages = useCallback(async (folder?: string) => {
    setLoading(true);
    try {
      const url = folder ? `/api/images?folder=${encodeURIComponent(folder)}` : '/api/images';
      const res = await fetch(url);
      const data = await res.json();
      setImages(data.images || []);
    } catch {
      addToast('Failed to load images', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  const handleFolderChange = (folder: string | null) => {
    setActiveFolder(folder);
    fetchImages(folder || undefined);
  };

  const handleDelete = useCallback(async (key: string) => {
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    try {
      const res = await fetch(`/api/images/${encodedKey}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setImages((prev) => prev.filter((img) => img.key !== key));
      addToast('Image deleted', 'success');
    } catch {
      addToast('Failed to delete image', 'error');
    }
  }, [addToast]);

  const handleUploadSuccess = useCallback(async (newFolders: string[]) => {
    setFolders(newFolders);
    setShowUpload(false);
    await fetchImages(activeFolder || undefined);
    addToast('Images uploaded successfully', 'success');
  }, [activeFolder, fetchImages, addToast]);

  const filteredImages = activeFolder
    ? images.filter((img) => img.folder === activeFolder)
    : images;

  const folderCount = (folder: string) => images.filter((img) => img.folder === folder).length;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">AK Gallery</h1>
          <p className="text-sm text-gray-500 mt-0.5">{images.length} image{images.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors shadow-sm"
        >
          <span className="text-lg leading-none">+</span>
          Upload
        </button>
      </header>

      {/* Folder tabs */}
      <div className="flex gap-2 flex-wrap mb-6">
        <button
          onClick={() => handleFolderChange(null)}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
            activeFolder === null
              ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-white text-gray-600 hover:bg-gray-100 shadow-sm'
          }`}
        >
          All <span className="ml-1 opacity-70">({images.length})</span>
        </button>
        {folders.map((f) => (
          <button
            key={f}
            onClick={() => handleFolderChange(f)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              activeFolder === f
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-white text-gray-600 hover:bg-gray-100 shadow-sm'
            }`}
          >
            {f} <span className="ml-1 opacity-70">({folderCount(f)})</span>
          </button>
        ))}
      </div>

      {/* Grid */}
      {loading ? (
        <SkeletonGrid />
      ) : filteredImages.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-gray-400">
          <div className="text-5xl mb-4">🖼️</div>
          <p className="text-lg font-medium">No images yet</p>
          <p className="text-sm mt-1">Upload some illustrations to get started</p>
          <button
            onClick={() => setShowUpload(true)}
            className="mt-6 px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors"
          >
            Upload first image
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filteredImages.map((image, i) => (
            <ImageCard
              key={image.key}
              image={image}
              onDelete={handleDelete}
              onClick={() => setLightboxIndex(i)}
            />
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <Lightbox
          images={filteredImages}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onPrev={() => setLightboxIndex((i) => (i !== null && i > 0 ? i - 1 : i))}
          onNext={() => setLightboxIndex((i) => (i !== null && i < filteredImages.length - 1 ? i + 1 : i))}
        />
      )}

      {/* Upload modal */}
      {showUpload && (
        <UploadModal
          folders={folders}
          onClose={() => setShowUpload(false)}
          onSuccess={handleUploadSuccess}
        />
      )}

      {/* Toasts */}
      <ToastList toasts={toasts} onRemove={removeToast} />
    </div>
  );
}

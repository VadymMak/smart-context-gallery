'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { GalleryImage } from '@/lib/r2';
import type { ImageMetadata } from '@/lib/metadata';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CurrentUser {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'member';
}

interface Props {
  initialImages: GalleryImage[];
  initialFolders: string[];
  initialMetadata: Record<string, ImageMetadata>;
  initialProjects: string[];
  currentUser: CurrentUser | null;
}

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error';
}

type SortOption = 'newest' | 'oldest' | 'name-asc' | 'category' | 'style';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  images?: { key: string; description: string; tags: string[]; folder: string }[];
}

interface SearchResult extends ImageMetadata {
  url?: string;
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sortImages(images: GalleryImage[], sort: SortOption, meta: Record<string, ImageMetadata>): GalleryImage[] {
  return [...images].sort((a, b) => {
    switch (sort) {
      case 'oldest': return a.lastModified.getTime() - b.lastModified.getTime();
      case 'name-asc': return a.filename.localeCompare(b.filename);
      case 'category': return (meta[a.key]?.category || 'z').localeCompare(meta[b.key]?.category || 'z');
      case 'style': return (meta[a.key]?.style || 'z').localeCompare(meta[b.key]?.style || 'z');
      default: return b.lastModified.getTime() - a.lastModified.getTime();
    }
  });
}

const CATEGORY_COLORS: Record<string, string> = {
  portrait: 'bg-pink-100 text-pink-700',
  landscape: 'bg-green-100 text-green-700',
  character: 'bg-purple-100 text-purple-700',
  animal: 'bg-orange-100 text-orange-700',
  'still-life': 'bg-yellow-100 text-yellow-700',
  abstract: 'bg-blue-100 text-blue-700',
  scene: 'bg-cyan-100 text-cyan-700',
  pattern: 'bg-indigo-100 text-indigo-700',
  other: 'bg-gray-100 text-gray-600',
};

// ─── Toast ────────────────────────────────────────────────────────────────────

function ToastList({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: number) => void }) {
  return (
    <div className="fixed top-6 right-6 flex flex-col gap-2 z-50 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto px-4 py-3 rounded-xl shadow-lg text-white text-sm font-medium flex items-center gap-2 animate-fadeIn ${
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
  meta,
  onDelete,
  onClick,
}: {
  image: GalleryImage;
  meta?: ImageMetadata;
  onDelete: (key: string) => void;
  onClick: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirming) { setConfirming(true); return; }
    setDeleting(true);
    await onDelete(image.key);
    setDeleting(false);
    setConfirming(false);
  };

  const categoryClass = meta?.category ? (CATEGORY_COLORS[meta.category] || CATEGORY_COLORS.other) : '';

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

      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors duration-200" />

      {meta?.category && (
        <div className={`absolute top-2 left-2 px-2 py-0.5 rounded-full text-xs font-medium ${categoryClass} opacity-0 group-hover:opacity-100 transition-opacity`}>
          {meta.category}
        </div>
      )}

      {confirming ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 gap-2 p-3" onClick={(e) => e.stopPropagation()}>
          <p className="text-white text-xs text-center font-medium">Delete this image?</p>
          <div className="flex gap-2">
            <button onClick={handleDelete} disabled={deleting} className="px-3 py-1 bg-red-600 text-white text-xs rounded-lg hover:bg-red-700 disabled:opacity-50">
              {deleting ? '...' : 'Delete'}
            </button>
            <button onClick={(e) => { e.stopPropagation(); setConfirming(false); }} className="px-3 py-1 bg-white/20 text-white text-xs rounded-lg hover:bg-white/30">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <button
            onClick={handleDelete}
            className="absolute top-2 right-2 w-8 h-8 bg-black/50 hover:bg-red-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center text-sm"
          >
            🗑
          </button>

          {meta?.description && (
            <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
              <p className="text-white text-xs line-clamp-2">{meta.description}</p>
              {meta.tags.length > 0 && (
                <div className="flex gap-1 flex-wrap mt-1">
                  {meta.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="text-white/70 text-xs">#{tag}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────

function Lightbox({
  images,
  index,
  meta,
  onClose,
  onPrev,
  onNext,
  projects,
  folders,
  onAssignProject,
  onMoveFolder,
}: {
  images: GalleryImage[];
  index: number;
  meta: Record<string, ImageMetadata>;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  projects: string[];
  folders: string[];
  onAssignProject: (key: string, project: string) => Promise<void>;
  onMoveFolder: (key: string, targetFolder: string) => Promise<void>;
}) {
  const image = images[index];
  const imgMeta = image ? meta[image.key] : undefined;
  const [showSidebar, setShowSidebar] = useState(true);
  const [assigningProject, setAssigningProject] = useState('');
  const [newProjectInput, setNewProjectInput] = useState('');
  const [movingFolder, setMovingFolder] = useState(false);
  const [newFolderInput, setNewFolderInput] = useState('');

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

  const handleAssignProject = async (project: string) => {
    setAssigningProject(project);
    await onAssignProject(image.key, project);
    setAssigningProject('');
    setNewProjectInput('');
  };

  const handleMoveFolder = async (targetFolder: string) => {
    if (!targetFolder.trim() || targetFolder === imgMeta?.folder) return;
    setMovingFolder(true);
    await onMoveFolder(image.key, targetFolder.trim());
    setMovingFolder(false);
    setNewFolderInput('');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex">
      {/* Image area */}
      <div className="flex-1 flex flex-col items-center justify-center relative p-4" onClick={onClose}>
        <button className="absolute top-4 left-4 w-10 h-10 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center text-xl transition-colors" onClick={onClose}>×</button>

        <button className="absolute top-4 right-4 w-10 h-10 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center text-sm transition-colors" onClick={(e) => { e.stopPropagation(); setShowSidebar((s) => !s); }}>
          {showSidebar ? '▶' : '◀'}
        </button>

        {index > 0 && (
          <button className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center text-xl transition-colors" onClick={(e) => { e.stopPropagation(); onPrev(); }}>‹</button>
        )}
        {index < images.length - 1 && (
          <button className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center text-xl transition-colors" onClick={(e) => { e.stopPropagation(); onNext(); }}>›</button>
        )}

        <div className="max-h-[85vh] flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.url} alt={image.filename} className="max-w-full max-h-[85vh] object-contain rounded-xl" />
        </div>

        <p className="text-white/50 text-xs mt-3">{index + 1} / {images.length}</p>
      </div>

      {/* Metadata sidebar */}
      {showSidebar && (
        <div className="w-72 bg-gray-900 border-l border-white/10 overflow-y-auto flex-shrink-0 p-4">
          <h3 className="text-white font-semibold mb-4 text-sm">{image.filename}</h3>

          {imgMeta ? (
            <div className="space-y-4">
              {/* Description */}
              <div>
                <p className="text-white/50 text-xs uppercase tracking-wider mb-1">Description</p>
                <p className="text-white/90 text-sm leading-relaxed">{imgMeta.description}</p>
              </div>

              {/* Tags */}
              {imgMeta.tags.length > 0 && (
                <div>
                  <p className="text-white/50 text-xs uppercase tracking-wider mb-2">Tags</p>
                  <div className="flex flex-wrap gap-1.5">
                    {imgMeta.tags.map((tag) => (
                      <span key={tag} className="px-2 py-0.5 bg-white/10 text-white/80 text-xs rounded-full">#{tag}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Category & Style */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-white/50 text-xs uppercase tracking-wider mb-1">Category</p>
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${CATEGORY_COLORS[imgMeta.category] || CATEGORY_COLORS.other}`}>
                    {imgMeta.category}
                  </span>
                </div>
                <div>
                  <p className="text-white/50 text-xs uppercase tracking-wider mb-1">Style</p>
                  <span className="text-white/80 text-sm">{imgMeta.style}</span>
                </div>
              </div>

              {/* Colors */}
              {imgMeta.colors.length > 0 && (
                <div>
                  <p className="text-white/50 text-xs uppercase tracking-wider mb-2">Colors</p>
                  <div className="flex gap-2 items-center">
                    {imgMeta.colors.map((color) => (
                      <span key={color} className="px-2 py-1 bg-white/10 text-white/70 text-xs rounded-lg">{color}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* File info */}
              <div>
                <p className="text-white/50 text-xs uppercase tracking-wider mb-2">Info</p>
                <div className="space-y-1 text-sm">
                  <p className="text-white/70"><span className="text-white/40">Folder:</span> {imgMeta.folder}</p>
                  {imgMeta.project && <p className="text-white/70"><span className="text-white/40">Project:</span> {imgMeta.project}</p>}
                  <p className="text-white/70"><span className="text-white/40">Size:</span> {formatBytes(imgMeta.size)}</p>
                  <p className="text-white/70"><span className="text-white/40">Uploaded:</span> {new Date(imgMeta.uploadedAt).toLocaleDateString()}</p>
                </div>
              </div>

              {/* Move folder */}
              <div>
                <p className="text-white/50 text-xs uppercase tracking-wider mb-2">Move to Folder</p>
                <div className="space-y-1.5">
                  {folders.filter((f) => f !== imgMeta?.folder).map((f) => (
                    <button
                      key={f}
                      onClick={() => handleMoveFolder(f)}
                      disabled={movingFolder}
                      className="w-full text-left px-3 py-1.5 rounded-lg text-xs bg-white/5 hover:bg-white/10 text-white/70 transition-colors disabled:opacity-50"
                    >
                      → {f}
                    </button>
                  ))}
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={newFolderInput}
                      onChange={(e) => setNewFolderInput(e.target.value)}
                      placeholder="New folder name..."
                      className="flex-1 px-2 py-1 bg-white/5 border border-white/10 rounded-lg text-xs text-white placeholder-white/30 focus:outline-none focus:border-white/30"
                      onKeyDown={(e) => e.key === 'Enter' && handleMoveFolder(newFolderInput)}
                    />
                    <button
                      onClick={() => handleMoveFolder(newFolderInput)}
                      disabled={movingFolder || !newFolderInput.trim()}
                      className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg transition-colors disabled:opacity-50"
                    >
                      {movingFolder ? '...' : '→'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Project assignment */}
              <div>
                <p className="text-white/50 text-xs uppercase tracking-wider mb-2">Assign Project</p>
                <div className="space-y-2">
                  {projects.map((p) => (
                    <button
                      key={p}
                      onClick={() => handleAssignProject(p)}
                      disabled={assigningProject === p || imgMeta.project === p}
                      className={`w-full text-left px-3 py-1.5 rounded-lg text-xs transition-colors ${
                        imgMeta.project === p
                          ? 'bg-blue-600/30 text-blue-300'
                          : 'bg-white/5 hover:bg-white/10 text-white/70'
                      }`}
                    >
                      {assigningProject === p ? '...' : (imgMeta.project === p ? '✓ ' : '')}
                      {p}
                    </button>
                  ))}
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={newProjectInput}
                      onChange={(e) => setNewProjectInput(e.target.value)}
                      placeholder="New project..."
                      className="flex-1 px-2 py-1 bg-white/5 border border-white/10 rounded-lg text-xs text-white placeholder-white/30 focus:outline-none focus:border-white/30"
                      onKeyDown={(e) => e.key === 'Enter' && newProjectInput.trim() && handleAssignProject(newProjectInput.trim())}
                    />
                    <button
                      onClick={() => newProjectInput.trim() && handleAssignProject(newProjectInput.trim())}
                      className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg transition-colors"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-white/40 text-sm">
              <p>No metadata available.</p>
              <p className="mt-1 text-xs">This image was uploaded before AI analysis was added.</p>
            </div>
          )}
        </div>
      )}
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

  const handleUpload = async () => {
    if (!selectedFiles.length) return;
    setUploading(true);
    setProgress('Analyzing with AI + uploading...');

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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-bold">Upload Images</h2>
            <p className="text-xs text-gray-500 mt-0.5">Auto-tagged by GPT-4o-mini Vision</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors mb-4 ${
            dragging ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-400 hover:bg-gray-50'
          }`}
        >
          <div className="text-4xl mb-2">📁</div>
          <p className="text-gray-600 text-sm">Drag & drop images here, or <span className="text-blue-600 font-medium">browse files</span></p>
          <p className="text-gray-400 text-xs mt-1">Max 10MB per file • AI analysis included</p>
          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => e.target.files && addFiles(e.target.files)} />
        </div>

        {selectedFiles.length > 0 && (
          <div className="flex gap-2 flex-wrap mb-4">
            {selectedFiles.map((f, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={URL.createObjectURL(f)} alt={f.name} className="w-16 h-16 object-cover rounded-lg border border-gray-200" />
                <button onClick={() => setSelectedFiles((prev) => prev.filter((_, j) => j !== i))} className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-xs flex items-center justify-center">×</button>
              </div>
            ))}
          </div>
        )}

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Folder</label>
          <div className="flex gap-2 mb-2">
            <button onClick={() => setUseNewFolder(false)} className={`text-sm px-3 py-1 rounded-lg border transition-colors ${!useNewFolder ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'}`}>Existing</button>
            <button onClick={() => setUseNewFolder(true)} className={`text-sm px-3 py-1 rounded-lg border transition-colors ${useNewFolder ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'}`}>New folder</button>
          </div>
          {useNewFolder ? (
            <input type="text" value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="e.g. animals, portraits..." className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          ) : (
            <select value={folder} onChange={(e) => setFolder(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="uncategorized">uncategorized</option>
              {folders.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          )}
        </div>

        {progress && <p className="text-sm mb-3 text-gray-500">{progress}</p>}

        <button onClick={handleUpload} disabled={!selectedFiles.length || uploading} className="w-full py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {uploading ? 'Analyzing + Uploading...' : `Upload ${selectedFiles.length || ''} file${selectedFiles.length !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  );
}

// ─── Chat Panel ───────────────────────────────────────────────────────────────

function ChatPanel({
  onClose,
  images,
}: {
  onClose: () => void;
  images: GalleryImage[];
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: 'Hi! Ask me about your gallery — search for images, see stats, manage projects, or just ask anything.' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          history: messages.slice(-6).map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      const data = await res.json();
      const assistantMsg: ChatMessage = { role: 'assistant', content: data.message || 'No response.' };
      if (data.type === 'search' && data.images) {
        assistantMsg.images = data.images;
      }
      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Error connecting to assistant.' }]);
    } finally {
      setLoading(false);
    }
  };

  const findImageUrl = (key: string) => images.find((img) => img.key === key)?.url;

  return (
    <div className="fixed bottom-20 right-6 z-40 w-96 max-w-[calc(100vw-3rem)] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden" style={{ height: '500px' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-blue-600 text-white flex-shrink-0">
        <div>
          <p className="font-semibold text-sm">Gallery Assistant</p>
          <p className="text-blue-200 text-xs">GPT-4o-mini</p>
        </div>
        <button onClick={onClose} className="w-7 h-7 flex items-center justify-center hover:bg-white/20 rounded-full transition-colors">×</button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'} rounded-2xl px-3 py-2 text-sm`}>
              <p className="whitespace-pre-line">{msg.content}</p>
              {msg.images && msg.images.length > 0 && (
                <div className="mt-2 grid grid-cols-3 gap-1">
                  {msg.images.slice(0, 6).map((img) => {
                    const url = findImageUrl(img.key);
                    return url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={img.key} src={url} alt={img.description} title={img.description} className="w-full aspect-square object-cover rounded-lg" />
                    ) : (
                      <div key={img.key} className="aspect-square bg-gray-200 rounded-lg flex items-center justify-center text-xs text-gray-400">?</div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl px-4 py-3">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 p-3 flex-shrink-0">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="Ask anything about your gallery..."
            className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={loading}
          />
          <button onClick={sendMessage} disabled={loading || !input.trim()} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
            →
          </button>
        </div>
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

export function GalleryClient({ initialImages, initialFolders, initialMetadata, initialProjects, currentUser }: Props) {
  const [images, setImages] = useState<GalleryImage[]>(initialImages);
  const [folders, setFolders] = useState<string[]>(initialFolders);
  const [metadata, setMetadata] = useState<Record<string, ImageMetadata>>(initialMetadata);
  const [projects, setProjects] = useState<string[]>(initialProjects);

  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('newest');

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);

  const addToast = useCallback((message: string, type: Toast['type']) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const removeToast = useCallback((id: number) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

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

  const fetchMetadata = useCallback(async () => {
    try {
      const res = await fetch('/api/metadata');
      if (!res.ok) return;
      const data = await res.json();
      setMetadata(data.images || {});
    } catch { /* silent */ }
  }, []);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      setProjects(data.projects || []);
    } catch { /* silent */ }
  }, []);

  const handleFolderChange = (folder: string | null) => {
    setActiveFolder(folder);
    setActiveProject(null);
    setSearchQuery('');
    setSearchResults(null);
    fetchImages(folder || undefined);
  };

  const handleProjectFilter = (project: string | null) => {
    setActiveProject(project);
    setSearchQuery('');
    setSearchResults(null);
  };

  const handleSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      const results: SearchResult[] = (data.results || []).map((r: ImageMetadata) => ({
        ...r,
        url: images.find((img) => img.key === r.key)?.url,
      }));
      setSearchResults(results);
    } catch {
      addToast('Search failed', 'error');
    } finally {
      setSearching(false);
    }
  }, [images, addToast]);

  const onSearchChange = (value: string) => {
    setSearchQuery(value);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (!value.trim()) { setSearchResults(null); return; }
    searchDebounce.current = setTimeout(() => handleSearch(value), 350);
  };

  const handleDelete = useCallback(async (key: string) => {
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    try {
      const res = await fetch(`/api/images/${encodedKey}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setImages((prev) => prev.filter((img) => img.key !== key));
      setMetadata((prev) => { const next = { ...prev }; delete next[key]; return next; });
      if (searchResults) setSearchResults((prev) => prev?.filter((r) => r.key !== key) || null);
      addToast('Image deleted', 'success');
    } catch {
      addToast('Failed to delete image', 'error');
    }
  }, [addToast, searchResults]);

  const handleUploadSuccess = useCallback(async (newFolders: string[]) => {
    setFolders(newFolders);
    setShowUpload(false);
    await fetchImages(activeFolder || undefined);
    await fetchMetadata();
    addToast('Images uploaded + analyzed', 'success');
  }, [activeFolder, fetchImages, fetchMetadata, addToast]);

  const handleAssignProject = useCallback(async (key: string, project: string) => {
    try {
      await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: [key], project }),
      });
      setMetadata((prev) => ({ ...prev, [key]: { ...prev[key], project } }));
      await fetchProjects();
      addToast(`Assigned to "${project}"`, 'success');
    } catch {
      addToast('Failed to assign project', 'error');
    }
  }, [addToast, fetchProjects]);

  const handleMoveFolder = useCallback(async (key: string, targetFolder: string) => {
    try {
      const res = await fetch('/api/images/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: [key], targetFolder }),
      });
      if (!res.ok) throw new Error('Move failed');
      const { moved } = await res.json() as { moved: { oldKey: string; newKey: string }[] };
      if (moved.length > 0) {
        const { oldKey, newKey } = moved[0];
        setImages((prev) => prev.map((img) =>
          img.key === oldKey ? { ...img, key: newKey, folder: targetFolder } : img
        ));
        setMetadata((prev) => {
          const next = { ...prev };
          if (next[oldKey]) {
            next[newKey] = { ...next[oldKey], key: newKey, folder: targetFolder };
            delete next[oldKey];
          }
          return next;
        });
        await fetchImages(activeFolder || undefined);
      }
      addToast(`Moved to "${targetFolder}"`, 'success');
    } catch {
      addToast('Failed to move image', 'error');
    }
  }, [addToast, fetchImages, activeFolder]);

  const handleLogout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }, []);

  // Build filtered + sorted image list
  let displayImages = images;
  if (activeProject) {
    displayImages = displayImages.filter((img) => metadata[img.key]?.project === activeProject);
  }
  displayImages = sortImages(displayImages, sortBy, metadata);

  const folderCount = (folder: string) => images.filter((img) => img.folder === folder).length;
  const projectCount = (project: string) => Object.values(metadata).filter((m) => m.project === project).length;

  // In search mode, convert SearchResult → GalleryImage-like for lightbox
  const isSearchMode = searchResults !== null;
  const searchImages_ = (searchResults || []).map((r) => ({
    key: r.key,
    url: r.url || '',
    size: r.size,
    lastModified: new Date(r.uploadedAt),
    folder: r.folder,
    filename: r.filename,
  }));

  const lightboxImages = isSearchMode ? searchImages_ : displayImages;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <header className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">AK Gallery</h1>
          <p className="text-sm text-gray-500 mt-0.5">{images.length} image{images.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="text-sm px-3 py-2 border border-gray-200 rounded-xl bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="name-asc">Name A–Z</option>
            <option value="category">By category</option>
            <option value="style">By style</option>
          </select>
          <button
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors shadow-sm"
          >
            <span className="text-lg leading-none">+</span>
            Upload
          </button>
          {currentUser && (
            <div className="flex items-center gap-1 pl-2 border-l border-gray-200">
              <span className="text-sm text-gray-600 hidden sm:block">{currentUser.displayName}</span>
              {currentUser.role === 'admin' && (
                <a
                  href="/settings"
                  className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 transition-colors text-gray-500"
                  title="Settings"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M19.07 4.93A10 10 0 1 0 4.93 19.07M19.07 4.93l-1.4 2.42M4.93 19.07l1.4-2.42"/>
                  </svg>
                </a>
              )}
              <button
                onClick={handleLogout}
                className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 transition-colors text-gray-500"
                title="Sign out"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                  <polyline points="16 17 21 12 16 7"/>
                  <line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Search bar */}
      <div className="relative mb-5">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search by tags, description, style, color..."
          className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
        {searchQuery && (
          <button
            onClick={() => { setSearchQuery(''); setSearchResults(null); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg"
          >
            ×
          </button>
        )}
      </div>

      {/* Folder tabs */}
      {!isSearchMode && (
        <div className="flex gap-2 flex-wrap mb-3">
          <button
            onClick={() => handleFolderChange(null)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activeFolder === null ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-600 hover:bg-gray-100 shadow-sm'}`}
          >
            All <span className="ml-1 opacity-70">({images.length})</span>
          </button>
          {folders.map((f) => (
            <button
              key={f}
              onClick={() => handleFolderChange(f)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activeFolder === f ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-600 hover:bg-gray-100 shadow-sm'}`}
            >
              {f} <span className="ml-1 opacity-70">({folderCount(f)})</span>
            </button>
          ))}
        </div>
      )}

      {/* Project filter */}
      {!isSearchMode && projects.length > 0 && (
        <div className="flex gap-2 flex-wrap mb-5 items-center">
          <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">Projects:</span>
          {activeProject && (
            <button onClick={() => handleProjectFilter(null)} className="px-3 py-1 rounded-full text-xs bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors">
              All
            </button>
          )}
          {projects.map((p) => (
            <button
              key={p}
              onClick={() => handleProjectFilter(activeProject === p ? null : p)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${activeProject === p ? 'bg-purple-600 text-white' : 'bg-purple-100 text-purple-700 hover:bg-purple-200'}`}
            >
              {p} ({projectCount(p)})
            </button>
          ))}
        </div>
      )}

      {/* Grid */}
      {searching ? (
        <SkeletonGrid />
      ) : loading ? (
        <SkeletonGrid />
      ) : isSearchMode ? (
        <>
          <p className="text-sm text-gray-500 mb-4">
            {searchResults!.length} result{searchResults!.length !== 1 ? 's' : ''} for <strong>"{searchQuery}"</strong>
          </p>
          {searchResults!.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <div className="text-5xl mb-4">🔍</div>
              <p className="text-lg font-medium">No results found</p>
              <p className="text-sm mt-1">Try different keywords</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {searchImages_.map((image, i) => (
                <ImageCard
                  key={image.key}
                  image={image}
                  meta={metadata[image.key]}
                  onDelete={handleDelete}
                  onClick={() => setLightboxIndex(i)}
                />
              ))}
            </div>
          )}
        </>
      ) : displayImages.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-gray-400">
          <div className="text-5xl mb-4">🖼️</div>
          <p className="text-lg font-medium">No images yet</p>
          <p className="text-sm mt-1">Upload some illustrations to get started</p>
          <button onClick={() => setShowUpload(true)} className="mt-6 px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors">
            Upload first image
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {displayImages.map((image, i) => (
            <ImageCard
              key={image.key}
              image={image}
              meta={metadata[image.key]}
              onDelete={handleDelete}
              onClick={() => setLightboxIndex(i)}
            />
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <Lightbox
          images={lightboxImages}
          index={lightboxIndex}
          meta={metadata}
          projects={projects}
          folders={folders}
          onClose={() => setLightboxIndex(null)}
          onPrev={() => setLightboxIndex((i) => (i !== null && i > 0 ? i - 1 : i))}
          onNext={() => setLightboxIndex((i) => (i !== null && i < lightboxImages.length - 1 ? i + 1 : i))}
          onAssignProject={handleAssignProject}
          onMoveFolder={handleMoveFolder}
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

      {/* Chat panel */}
      {showChat && <ChatPanel onClose={() => setShowChat(false)} images={images} />}

      {/* Chat button */}
      <button
        onClick={() => setShowChat((v) => !v)}
        className={`fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-2xl transition-all z-30 ${showChat ? 'bg-gray-800 hover:bg-gray-900' : 'bg-blue-600 hover:bg-blue-700'}`}
        title="Gallery Assistant"
      >
        {showChat ? '×' : '💬'}
      </button>

      {/* Toasts */}
      <ToastList toasts={toasts} onRemove={removeToast} />
    </div>
  );
}

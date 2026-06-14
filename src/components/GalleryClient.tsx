'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { GalleryImage } from '@/lib/r2';
import type { ImageMetadata } from '@/lib/metadata';
import type { Share } from '@/lib/shares';
import { ShareModal } from '@/components/ShareModal';

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
  user: CurrentUser | null;
}

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error';
}

interface UploadProgress {
  total: number;
  completed: number;
  current: string;
  failed: string[];
  isUploading: boolean;
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

interface FileWithFolder {
  file: File;
  folder: string;
}

interface FolderNode {
  name: string;
  path: string;
  children: FolderNode[];
  imageCount: number;
  totalCount: number;
}

// ─── Folder tree helpers ───────────────────────────────────────────────────────

function buildFolderTree(images: GalleryImage[], extraPaths: string[] = []): FolderNode {
  const folderMap = new Map<string, FolderNode>();

  const ensureNode = (path: string, parentChildren: FolderNode[]): FolderNode => {
    if (folderMap.has(path)) return folderMap.get(path)!;
    const name = path.split('/').pop()!;
    const node: FolderNode = { name, path, children: [], imageCount: 0, totalCount: 0 };
    folderMap.set(path, node);
    parentChildren.push(node);
    parentChildren.sort((a, b) => a.name.localeCompare(b.name));
    return node;
  };

  const root: FolderNode = { name: 'All Images', path: '', children: [], imageCount: 0, totalCount: 0 };

  for (const path of extraPaths) {
    if (!path) continue;
    const parts = path.split('/');
    let parentChildren = root.children;
    let currentPath = '';
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const node = ensureNode(currentPath, parentChildren);
      parentChildren = node.children;
    }
  }

  for (const img of images) {
    const parts = img.key.split('/');
    const folderParts = parts.slice(1, -1);
    if (folderParts.length === 0) continue;

    let parentChildren = root.children;
    let currentPath = '';
    for (let i = 0; i < folderParts.length; i++) {
      const part = folderParts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const node = ensureNode(currentPath, parentChildren);
      if (i === folderParts.length - 1) node.imageCount++;
      parentChildren = node.children;
    }
  }

  const calcTotal = (node: FolderNode): number => {
    node.totalCount = node.imageCount + node.children.reduce((sum, child) => sum + calcTotal(child), 0);
    return node.totalCount;
  };
  root.children.forEach(calcTotal);
  root.totalCount = images.length;

  return root;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toTimestamp(value: Date | string | number | undefined | null): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = new Date(value as string).getTime();
  return isNaN(parsed) ? 0 : parsed;
}

// Strip numeric timestamp prefix added during R2 upload (e.g. "1718123456789-filename.pdf" → "filename.pdf")
function displayName(filename: string): string {
  return filename.replace(/^\d{10,}-/, '');
}

function sortImages(
  images: GalleryImage[],
  sort: SortOption,
  meta: Record<string, ImageMetadata>
): GalleryImage[] {
  return [...images].sort((a, b) => {
    switch (sort) {
      case 'oldest': return toTimestamp(a.lastModified) - toTimestamp(b.lastModified);
      case 'name-asc': return a.filename.localeCompare(b.filename);
      case 'category': return (meta[a.key]?.category || 'z').localeCompare(meta[b.key]?.category || 'z');
      case 'style': return (meta[a.key]?.style || 'z').localeCompare(meta[b.key]?.style || 'z');
      default: return toTimestamp(b.lastModified) - toTimestamp(a.lastModified);
    }
  });
}

async function readDirectory(
  dirEntry: FileSystemDirectoryEntry,
  folderName: string
): Promise<FileWithFolder[]> {
  const results: FileWithFolder[] = [];
  const reader = dirEntry.createReader();
  const readEntries = (): Promise<FileSystemEntry[]> =>
    new Promise((resolve, reject) => reader.readEntries(resolve, reject));

  let entries = await readEntries();
  while (entries.length > 0) {
    for (const entry of entries) {
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) =>
          (entry as FileSystemFileEntry).file(resolve, reject)
        );
        results.push({ file, folder: folderName });
      } else if (entry.isDirectory) {
        const sub = await readDirectory(entry as FileSystemDirectoryEntry, entry.name);
        results.push(...sub);
      }
    }
    entries = await readEntries();
  }
  return results;
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

// ─── File type helpers ────────────────────────────────────────────────────────

const IMAGE_EXTS = new Set(['jpg','jpeg','png','gif','webp','svg','bmp','heic','avif']);
const DOC_EXTS   = new Set(['pdf','doc','docx']);
const SHEET_EXTS = new Set(['xls','xlsx','csv']);
const SLIDE_EXTS = new Set(['ppt','pptx']);
const TEXT_EXTS  = new Set(['txt','md','rtf']);
const ARCH_EXTS  = new Set(['zip','rar','7z','tar','gz']);
const VIDEO_EXTS = new Set(['mp4','mov','avi','mkv','webm']);
const AUDIO_EXTS = new Set(['mp3','wav','ogg','flac','aac']);

type FileKind = 'image' | 'pdf' | 'document' | 'spreadsheet' | 'presentation' | 'text' | 'archive' | 'video' | 'audio' | 'file';

function getFileKind(filename: string): { kind: FileKind; color: string } {
  const ext = filename.toLowerCase().split('.').pop() || '';
  if (IMAGE_EXTS.has(ext)) return { kind: 'image',        color: 'bg-blue-100 text-blue-700' };
  if (ext === 'pdf')        return { kind: 'pdf',          color: 'bg-red-100 text-red-700' };
  if (DOC_EXTS.has(ext))   return { kind: 'document',     color: 'bg-blue-100 text-blue-700' };
  if (SHEET_EXTS.has(ext)) return { kind: 'spreadsheet',  color: 'bg-green-100 text-green-700' };
  if (SLIDE_EXTS.has(ext)) return { kind: 'presentation', color: 'bg-orange-100 text-orange-700' };
  if (TEXT_EXTS.has(ext))  return { kind: 'text',         color: 'bg-gray-100 text-gray-700' };
  if (ARCH_EXTS.has(ext))  return { kind: 'archive',      color: 'bg-yellow-100 text-yellow-700' };
  if (VIDEO_EXTS.has(ext)) return { kind: 'video',        color: 'bg-purple-100 text-purple-700' };
  if (AUDIO_EXTS.has(ext)) return { kind: 'audio',        color: 'bg-pink-100 text-pink-700' };
  return { kind: 'file', color: 'bg-gray-100 text-gray-600' };
}

function isImageFile(filename: string): boolean {
  return getFileKind(filename).kind === 'image';
}

function FileTypeIcon({ ext }: { ext: string }) {
  const e = ext.toLowerCase();
  const docPath = (
    <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>
  );
  if (e === 'pdf') return (
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      {docPath}
      <line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="11" y2="17"/>
      <text x="7.5" y="17.5" fontSize="5.5" fill="currentColor" stroke="none" fontWeight="bold">PDF</text>
    </svg>
  );
  if (e === 'doc' || e === 'docx') return (
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      {docPath}<line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>
    </svg>
  );
  if (e === 'xls' || e === 'xlsx' || e === 'csv') return (
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      {docPath}
      <rect x="7" y="12" width="10" height="6" rx="0.5"/>
      <line x1="12" y1="12" x2="12" y2="18"/><line x1="7" y1="15" x2="17" y2="15"/>
    </svg>
  );
  if (e === 'ppt' || e === 'pptx') return (
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      {docPath}<rect x="8" y="12" width="8" height="5" rx="0.5"/>
    </svg>
  );
  if (ARCH_EXTS.has(e)) return (
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M21 8v13H3V3h12l6 5z"/>
      <rect x="9" y="10" width="6" height="8" rx="1"/>
      <line x1="12" y1="10" x2="12" y2="13"/>
    </svg>
  );
  if (VIDEO_EXTS.has(e)) return (
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/>
      <line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/>
      <line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/>
      <line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>
    </svg>
  );
  if (AUDIO_EXTS.has(e)) return (
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
    </svg>
  );
  // default file
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    <line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
  </svg>
);
const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
const UploadIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
  </svg>
);
const ChatIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
);
const SettingsIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
);
const LogoutIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
  </svg>
);

// ─── Toast ────────────────────────────────────────────────────────────────────

function ToastList({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: number) => void }) {
  return (
    <div className="fixed top-6 right-6 flex flex-col gap-2 z-[80] pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className={`pointer-events-auto px-4 py-3 rounded-xl shadow-lg text-white text-sm font-medium flex items-center gap-2 ${t.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          <span>{t.type === 'success' ? '✓' : '✕'}</span>
          {t.message}
          <button onClick={() => onRemove(t.id)} className="ml-2 opacity-70 hover:opacity-100">×</button>
        </div>
      ))}
    </div>
  );
}

// ─── Folder Tree Item ─────────────────────────────────────────────────────────

interface FolderTreeItemProps {
  node: FolderNode;
  selectedPath: string;
  onSelect: (path: string) => void;
  onCreateSubfolder: (parentPath: string) => void;
  onRename: (path: string, newName: string) => void;
  onDelete: (path: string) => void;
  onShare: (path: string) => void;
  depth: number;
  isRoot?: boolean;
}

function FolderTreeItem({ node, selectedPath, onSelect, onCreateSubfolder, onRename, onDelete, onShare, depth, isRoot }: FolderTreeItemProps) {
  const [isExpanded, setIsExpanded] = useState(isRoot || depth === 0);
  const [showMenu, setShowMenu] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);
  const menuRef = useRef<HTMLDivElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  const isSelected = selectedPath === node.path;
  const hasChildren = node.children.length > 0;

  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  useEffect(() => {
    if (isRenaming) renameRef.current?.select();
  }, [isRenaming]);

  const submitRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== node.name) onRename(node.path, trimmed);
    setIsRenaming(false);
  };

  const indentPx = depth * 16 + 8;

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1.5 mx-1 rounded-lg cursor-pointer group select-none ${
          isSelected ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
        }`}
        style={{ paddingLeft: `${indentPx}px`, paddingRight: '6px' }}
        onClick={() => {
          onSelect(node.path);
          if (hasChildren) setIsExpanded((v) => !v);
        }}
      >
        {/* Expand arrow */}
        {hasChildren ? (
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            className={`shrink-0 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}>
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        ) : (
          <span className="w-[13px] shrink-0" />
        )}

        {/* Folder icon */}
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill={isSelected ? '#3b82f6' : '#9ca3af'} stroke="none" className="shrink-0">
          <path d="M2 6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z"/>
        </svg>

        {/* Name or rename input */}
        {isRenaming && !isRoot ? (
          <input
            ref={renameRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitRename();
              if (e.key === 'Escape') { setIsRenaming(false); setRenameValue(node.name); }
              e.stopPropagation();
            }}
            onBlur={submitRename}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 text-sm bg-blue-50 border border-blue-300 rounded px-1 py-0 outline-none min-w-0"
          />
        ) : (
          <span className="text-sm truncate flex-1">{isRoot ? 'All Images' : node.name}</span>
        )}

        {/* Count */}
        <span className={`text-xs shrink-0 ml-1 ${isSelected ? 'text-blue-500' : 'text-gray-400'}`}>
          {node.totalCount > 0 ? node.totalCount : ''}
        </span>

        {/* Context menu button */}
        {!isRoot && !isRenaming && (
          <div className="relative" ref={menuRef}>
            <button
              onClick={(e) => { e.stopPropagation(); setShowMenu((v) => !v); }}
              className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-gray-200 shrink-0 ml-0.5"
              title="Folder options"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
              </svg>
            </button>

            {showMenu && (
              <div className="absolute right-0 top-6 bg-white border border-gray-200 rounded-xl shadow-xl py-1 z-30 w-44" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => { onCreateSubfolder(node.path); setShowMenu(false); }}
                  className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                    <line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>
                  </svg>
                  New subfolder
                </button>
                <button
                  onClick={() => { setIsRenaming(true); setRenameValue(node.name); setShowMenu(false); }}
                  className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
                  </svg>
                  Rename
                </button>
                <button
                  onClick={() => { onShare(node.path); setShowMenu(false); }}
                  className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                  </svg>
                  Share folder
                </button>
                <div className="h-px bg-gray-100 my-1" />
                <button
                  onClick={() => { onDelete(node.path); setShowMenu(false); }}
                  className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  </svg>
                  Delete folder
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {isExpanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <FolderTreeItem
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              onSelect={onSelect}
              onCreateSubfolder={onCreateSubfolder}
              onRename={onRename}
              onDelete={onDelete}
              onShare={onShare}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Create Folder Modal ──────────────────────────────────────────────────────

function CreateFolderModal({
  parentPath,
  onConfirm,
  onCancel,
}: {
  parentPath: string | null;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onCancel]);

  const sanitized = name.toLowerCase().replace(/[^a-z0-9\-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]" onClick={onCancel}>
      <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-1">
          {parentPath ? `New subfolder in "${parentPath.split('/').pop()}"` : 'New folder'}
        </h3>
        <p className="text-xs text-gray-400 mb-4">Lowercase letters, numbers and hyphens only.</p>

        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. animals, my-drawings"
          className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 mb-1 text-sm"
          onKeyDown={(e) => e.key === 'Enter' && sanitized && onConfirm(sanitized)}
        />
        {name && sanitized !== name && (
          <p className="text-xs text-gray-400 mb-3">Will be saved as: <strong>{sanitized}</strong></p>
        )}

        <div className="flex gap-3 mt-4">
          <button onClick={onCancel} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-gray-700 hover:bg-gray-50 font-medium transition-colors">
            Cancel
          </button>
          <button
            onClick={() => sanitized && onConfirm(sanitized)}
            disabled={!sanitized}
            className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium disabled:opacity-50 transition-colors"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Delete Confirm Modal ─────────────────────────────────────────────────────

function DeleteConfirmModal({ image, deleting, onConfirm, onCancel }: {
  image: GalleryImage; deleting: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70]" onClick={onCancel}>
      <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-1">Delete image?</h3>
        <p className="text-gray-500 text-sm mb-4">This cannot be undone.</p>
        <div className="flex items-center gap-3 mb-6 p-3 bg-gray-50 rounded-xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.url} alt="" className="w-16 h-16 object-cover rounded-lg flex-shrink-0" />
          <span className="text-sm text-gray-600 truncate">{image.filename}</span>
        </div>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-gray-700 hover:bg-gray-50 font-medium transition-colors">Cancel</button>
          <button onClick={onConfirm} disabled={deleting} className="flex-1 py-2.5 bg-red-500 text-white rounded-xl hover:bg-red-600 font-medium disabled:opacity-50 transition-colors">
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── File Card ────────────────────────────────────────────────────────────────

function FileCard({ file, meta, selectMode, selected, onToggleSelect, onDeleteRequest, onShareRequest, onClick }: {
  file: GalleryImage; meta?: ImageMetadata; selectMode: boolean; selected: boolean;
  onToggleSelect: (key: string) => void; onDeleteRequest: (file: GalleryImage) => void;
  onShareRequest: (file: GalleryImage) => void; onClick: () => void;
}) {
  const { kind, color } = getFileKind(file.filename);
  const isImg = kind === 'image';
  const ext = file.filename.toLowerCase().split('.').pop() || '';
  const categoryClass = meta?.category ? (CATEGORY_COLORS[meta.category] || CATEGORY_COLORS.other) : '';

  return (
    <div
      className={`group relative bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all cursor-pointer aspect-square ${selected ? 'ring-2 ring-blue-500 ring-offset-2' : ''}`}
      onClick={() => selectMode ? onToggleSelect(file.key) : onClick()}
    >
      {isImg ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={file.url} alt={file.filename} className="w-full h-full object-cover transition-transform group-hover:scale-105 duration-300" loading="lazy" />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors duration-200" />
          {!selectMode && meta?.category && (
            <div className={`absolute top-2 left-2 px-2 py-0.5 rounded-full text-xs font-medium ${categoryClass} opacity-0 group-hover:opacity-100 transition-opacity`}>{meta.category}</div>
          )}
          {!selectMode && meta?.description && (
            <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
              <p className="text-white text-xs line-clamp-2">{meta.description}</p>
              {meta.tags.length > 0 && (
                <div className="flex gap-1 flex-wrap mt-1">
                  {meta.tags.slice(0, 3).map((tag) => <span key={tag} className="text-white/70 text-xs">#{tag}</span>)}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50 p-2 sm:p-4 hover:bg-gray-100 transition-colors">
          <div className={`w-10 h-10 sm:w-14 sm:h-14 rounded-2xl ${color} flex items-center justify-center mb-1.5 sm:mb-2.5 flex-shrink-0`}>
            <FileTypeIcon ext={ext} />
          </div>
          <div className="w-full min-w-0 px-1 text-center">
            <p className="text-xs text-gray-700 font-medium truncate" title={file.filename}>
              {displayName(file.filename)}
            </p>
            <p className="text-[10px] text-gray-400 mt-0.5">{formatBytes(file.size)}</p>
            <span className="mt-1 inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-gray-200 text-gray-600">{ext}</span>
          </div>
        </div>
      )}

      {selectMode ? (
        <div className={`absolute top-2 left-2 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors z-10 ${selected ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white/80 border-gray-300'}`}>
          {selected && <CheckIcon />}
        </div>
      ) : (
        <div className="absolute top-2 right-2 flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all duration-200 z-10">
          <button
            onClick={(e) => { e.stopPropagation(); onShareRequest(file); }}
            className="min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center p-1.5 bg-white/90 hover:bg-blue-500 hover:text-white text-gray-700 rounded-full shadow-sm transition-colors"
            title="Share"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDeleteRequest(file); }}
            className="min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center p-1.5 bg-white/90 hover:bg-red-500 hover:text-white text-gray-700 rounded-full shadow-sm transition-colors"
            title="Delete"
          >
            <TrashIcon />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────

function Lightbox({ images, index, meta, onClose, onPrev, onNext, projects, allFolderPaths, onAssignProject, onMoveFolder, onDeleteRequest }: {
  images: GalleryImage[]; index: number; meta: Record<string, ImageMetadata>;
  onClose: () => void; onPrev: () => void; onNext: () => void;
  projects: string[]; allFolderPaths: string[];
  onAssignProject: (key: string, project: string) => Promise<void>;
  onMoveFolder: (key: string, targetFolder: string) => Promise<void>;
  onDeleteRequest: (image: GalleryImage) => void;
}) {
  const image = images[index];
  const imgMeta = image ? meta[image.key] : undefined;
  const [showSidebar, setShowSidebar] = useState(true);
  const [assigningProject, setAssigningProject] = useState('');
  const [newProjectInput, setNewProjectInput] = useState('');
  const [movingFolder, setMovingFolder] = useState(false);
  const [newFolderInput, setNewFolderInput] = useState('');

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onPrev();
      if (e.key === 'ArrowRight') onNext();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, onPrev, onNext]);

  if (!image) return null;

  const imgFolderPath = image.key.split('/').slice(1, -1).join('/');

  const handleAssignProject = async (project: string) => {
    setAssigningProject(project);
    await onAssignProject(image.key, project);
    setAssigningProject('');
    setNewProjectInput('');
  };

  const handleMoveFolder = async (targetFolder: string) => {
    if (!targetFolder.trim() || targetFolder === imgFolderPath) return;
    setMovingFolder(true);
    await onMoveFolder(image.key, targetFolder.trim());
    setMovingFolder(false);
    setNewFolderInput('');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex">
      <div className="flex-1 flex flex-col items-center justify-center relative p-4" onClick={onClose}>
        <div className="absolute top-4 left-4 right-4 flex justify-between items-center">
          <button className="w-10 h-10 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center text-xl transition-colors" onClick={onClose}>×</button>
          <div className="flex items-center gap-2">
            <button onClick={(e) => { e.stopPropagation(); onDeleteRequest(image); }} className="flex items-center gap-1.5 px-3 py-2 bg-red-500/80 hover:bg-red-600 text-white rounded-xl text-sm font-medium transition-colors">
              <TrashIcon /> Delete
            </button>
            <button className="w-10 h-10 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center text-sm transition-colors" onClick={(e) => { e.stopPropagation(); setShowSidebar((s) => !s); }}>
              {showSidebar ? '▶' : '◀'}
            </button>
          </div>
        </div>
        {index > 0 && <button className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center text-xl transition-colors" onClick={(e) => { e.stopPropagation(); onPrev(); }}>‹</button>}
        {index < images.length - 1 && <button className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center text-xl transition-colors" onClick={(e) => { e.stopPropagation(); onNext(); }}>›</button>}
        <div className="max-h-[80vh] flex items-center justify-center mt-12" onClick={(e) => e.stopPropagation()}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.url} alt={image.filename} className="max-w-full max-h-[80vh] object-contain rounded-xl" />
        </div>
        <p className="text-white/50 text-xs mt-3">{index + 1} / {images.length}</p>
      </div>

      {showSidebar && (
        <div className="w-72 bg-gray-900 border-l border-white/10 overflow-y-auto flex-shrink-0 p-4">
          <h3 className="text-white font-semibold mb-4 text-sm">{image.filename}</h3>
          {imgMeta ? (
            <div className="space-y-4">
              <div>
                <p className="text-white/50 text-xs uppercase tracking-wider mb-1">Description</p>
                <p className="text-white/90 text-sm leading-relaxed">{imgMeta.description}</p>
              </div>
              {imgMeta.tags.length > 0 && (
                <div>
                  <p className="text-white/50 text-xs uppercase tracking-wider mb-2">Tags</p>
                  <div className="flex flex-wrap gap-1.5">
                    {imgMeta.tags.map((tag) => <span key={tag} className="px-2 py-0.5 bg-white/10 text-white/80 text-xs rounded-full">#{tag}</span>)}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-white/50 text-xs uppercase tracking-wider mb-1">Category</p>
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${CATEGORY_COLORS[imgMeta.category] || CATEGORY_COLORS.other}`}>{imgMeta.category}</span>
                </div>
                <div>
                  <p className="text-white/50 text-xs uppercase tracking-wider mb-1">Style</p>
                  <span className="text-white/80 text-sm">{imgMeta.style}</span>
                </div>
              </div>
              {imgMeta.colors.length > 0 && (
                <div>
                  <p className="text-white/50 text-xs uppercase tracking-wider mb-2">Colors</p>
                  <div className="flex gap-2 flex-wrap">
                    {imgMeta.colors.map((color) => <span key={color} className="px-2 py-1 bg-white/10 text-white/70 text-xs rounded-lg">{color}</span>)}
                  </div>
                </div>
              )}
              <div>
                <p className="text-white/50 text-xs uppercase tracking-wider mb-2">Info</p>
                <div className="space-y-1 text-sm">
                  <p className="text-white/70"><span className="text-white/40">Folder:</span> {imgFolderPath || 'root'}</p>
                  {imgMeta.project && <p className="text-white/70"><span className="text-white/40">Project:</span> {imgMeta.project}</p>}
                  <p className="text-white/70"><span className="text-white/40">Size:</span> {formatBytes(imgMeta.size)}</p>
                  <p className="text-white/70" suppressHydrationWarning><span className="text-white/40">Uploaded:</span> {new Date(imgMeta.uploadedAt).toLocaleDateString()}</p>
                </div>
              </div>
              <div>
                <p className="text-white/50 text-xs uppercase tracking-wider mb-2">Move to Folder</p>
                <div className="space-y-1.5">
                  {allFolderPaths.filter((f) => f !== imgFolderPath).map((f) => (
                    <button key={f} onClick={() => handleMoveFolder(f)} disabled={movingFolder} className="w-full text-left px-3 py-1.5 rounded-lg text-xs bg-white/5 hover:bg-white/10 text-white/70 transition-colors disabled:opacity-50">
                      → {f}
                    </button>
                  ))}
                  <div className="flex gap-1">
                    <input type="text" value={newFolderInput} onChange={(e) => setNewFolderInput(e.target.value)} placeholder="folder/path..." className="flex-1 px-2 py-1 bg-white/5 border border-white/10 rounded-lg text-xs text-white placeholder-white/30 focus:outline-none focus:border-white/30" onKeyDown={(e) => e.key === 'Enter' && handleMoveFolder(newFolderInput)} />
                    <button onClick={() => handleMoveFolder(newFolderInput)} disabled={movingFolder || !newFolderInput.trim()} className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg transition-colors disabled:opacity-50">
                      {movingFolder ? '...' : '→'}
                    </button>
                  </div>
                </div>
              </div>
              <div>
                <p className="text-white/50 text-xs uppercase tracking-wider mb-2">Assign Project</p>
                <div className="space-y-2">
                  {projects.map((p) => (
                    <button key={p} onClick={() => handleAssignProject(p)} disabled={assigningProject === p || imgMeta.project === p} className={`w-full text-left px-3 py-1.5 rounded-lg text-xs transition-colors ${imgMeta.project === p ? 'bg-blue-600/30 text-blue-300' : 'bg-white/5 hover:bg-white/10 text-white/70'}`}>
                      {assigningProject === p ? '...' : (imgMeta.project === p ? '✓ ' : '')}{p}
                    </button>
                  ))}
                  <div className="flex gap-1">
                    <input type="text" value={newProjectInput} onChange={(e) => setNewProjectInput(e.target.value)} placeholder="New project..." className="flex-1 px-2 py-1 bg-white/5 border border-white/10 rounded-lg text-xs text-white placeholder-white/30 focus:outline-none focus:border-white/30" onKeyDown={(e) => e.key === 'Enter' && newProjectInput.trim() && handleAssignProject(newProjectInput.trim())} />
                    <button onClick={() => newProjectInput.trim() && handleAssignProject(newProjectInput.trim())} className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg transition-colors">+</button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-white/40 text-sm">
              <p>No metadata available.</p>
              <p className="mt-1 text-xs">Uploaded before AI analysis was added.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Chat Panel ───────────────────────────────────────────────────────────────

function ChatPanel({ onClose, images }: { onClose: () => void; images: GalleryImage[] }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: 'Hi! Ask me about your gallery — search for images, see stats, manage projects, or just ask anything.' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

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
        body: JSON.stringify({ message: userMsg, history: messages.slice(-6).map((m) => ({ role: m.role, content: m.content })) }),
      });
      const data = await res.json();
      const msg: ChatMessage = { role: 'assistant', content: data.message || 'No response.' };
      if (data.type === 'search' && data.images) msg.images = data.images;
      setMessages((prev) => [...prev, msg]);
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Error connecting to assistant.' }]);
    } finally {
      setLoading(false);
    }
  };

  const findUrl = (key: string) => images.find((img) => img.key === key)?.url;

  return (
    <div className="fixed bottom-24 right-6 z-40 w-96 max-w-[calc(100vw-3rem)] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden" style={{ height: '500px' }}>
      <div className="flex items-center justify-between px-4 py-3 bg-blue-600 text-white flex-shrink-0">
        <div><p className="font-semibold text-sm">Gallery Assistant</p><p className="text-blue-200 text-xs">GPT-4o-mini</p></div>
        <button onClick={onClose} className="w-7 h-7 flex items-center justify-center hover:bg-white/20 rounded-full">×</button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'} rounded-2xl px-3 py-2 text-sm`}>
              <p className="whitespace-pre-line">{msg.content}</p>
              {msg.images && msg.images.length > 0 && (
                <div className="mt-2 grid grid-cols-3 gap-1">
                  {msg.images.slice(0, 6).map((img) => {
                    const url = findUrl(img.key);
                    return url
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img key={img.key} src={url} alt="" title={img.description} className="w-full aspect-square object-cover rounded-lg" />
                      : <div key={img.key} className="aspect-square bg-gray-200 rounded-lg" />;
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
                {[0, 150, 300].map((d) => <span key={d} className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />)}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="border-t border-gray-200 p-3 flex-shrink-0">
        <div className="flex gap-2">
          <input type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendMessage()} placeholder="Ask anything about your gallery..." className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" disabled={loading} />
          <button onClick={sendMessage} disabled={loading || !input.trim()} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">→</button>
        </div>
      </div>
    </div>
  );
}

// ─── Upload Modal ─────────────────────────────────────────────────────────────

function UploadModal({ allFolderPaths, defaultFolder, onClose, onStartUpload }: {
  allFolderPaths: string[]; defaultFolder: string;
  onClose: () => void; onStartUpload: (files: FileWithFolder[]) => void;
}) {
  const [selectedFiles, setSelectedFiles] = useState<FileWithFolder[]>([]);
  const [folder, setFolder] = useState(defaultFolder || allFolderPaths[0] || 'uncategorized');
  const [newFolder, setNewFolder] = useState('');
  const [useNewFolder, setUseNewFolder] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);

  const activeFolder = useNewFolder
    ? (newFolder.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-_/]/g, '') || 'uncategorized')
    : folder;

  const addRawFiles = (rawFiles: FileList | File[]) => {
    const items = Array.from(rawFiles).map((f) => ({ file: f, folder: activeFolder }));
    setSelectedFiles((prev) => [...prev, ...items]);
  };

  const handleFolderInput = (fileList: FileList | null) => {
    if (!fileList) return;
    const files: FileWithFolder[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || '';
      const parts = rel.split('/');
      files.push({ file, folder: parts.length > 1 ? parts[0] : 'uncategorized' });
    }
    if (files.length > 0) { onClose(); onStartUpload(files); }
  };

  const handleModalDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    const items = e.dataTransfer.items;
    const files: FileWithFolder[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind !== 'file') continue;
      const entry = item.webkitGetAsEntry?.();
      if (entry?.isDirectory) {
        const sub = await readDirectory(entry as FileSystemDirectoryEntry, entry.name);
        files.push(...sub);
      } else {
        const file = item.getAsFile();
        if (file) files.push({ file, folder: activeFolder });
      }
    }
    if (files.length > 0) setSelectedFiles((prev) => [...prev, ...files]);
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div><h2 className="text-lg font-bold">Upload Files</h2><p className="text-xs text-gray-500 mt-0.5">Images auto-tagged by AI · Any file type · Max 50 MB</p></div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>

        <div
          onDragEnter={(e) => { e.preventDefault(); dragCounter.current++; setDragging(true); }}
          onDragLeave={(e) => { e.preventDefault(); dragCounter.current--; if (dragCounter.current === 0) setDragging(false); }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleModalDrop}
          className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors mb-4 ${dragging ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}
        >
          <div className="text-4xl mb-2">📁</div>
          <p className="text-gray-600 text-sm">Drag & drop files or folders here</p>
          <p className="text-gray-400 text-xs mt-1">Any file type · Max 50 MB · Images auto-tagged by AI</p>
        </div>

        <div className="flex gap-3 mb-4">
          <label className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl font-medium text-center text-sm cursor-pointer hover:bg-blue-700 transition-colors">
            Select Files
            <input type="file" multiple className="hidden" onChange={(e) => addRawFiles(e.target.files || new FileList())} />
          </label>
          <label className="flex-1 py-2.5 border-2 border-blue-600 text-blue-600 rounded-xl font-medium text-center text-sm cursor-pointer hover:bg-blue-50 transition-colors">
            Select Folder
            {/* @ts-expect-error — webkitdirectory not in types */}
            <input type="file" webkitdirectory="" directory="" multiple className="hidden" onChange={(e) => handleFolderInput(e.target.files)} />
          </label>
        </div>

        {selectedFiles.length > 0 && (
          <div className="flex gap-2 flex-wrap mb-4 max-h-32 overflow-y-auto">
            {selectedFiles.map((f, i) => {
              const { kind, color } = getFileKind(f.file.name);
              const ext = f.file.name.split('.').pop() || '';
              return (
                <div key={i} className="relative flex-shrink-0">
                  {kind === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={URL.createObjectURL(f.file)} alt="" className="w-14 h-14 object-cover rounded-lg border border-gray-200" />
                  ) : (
                    <div className={`w-14 h-14 rounded-lg border border-gray-200 ${color} flex flex-col items-center justify-center gap-0.5`}>
                      <FileTypeIcon ext={ext} />
                      <span className="text-[9px] font-bold uppercase leading-none">{ext}</span>
                    </div>
                  )}
                  <button onClick={() => setSelectedFiles((prev) => prev.filter((_, j) => j !== i))} className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-xs flex items-center justify-center">×</button>
                </div>
              );
            })}
          </div>
        )}

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Target Folder</label>
          <div className="flex gap-2 mb-2">
            <button onClick={() => setUseNewFolder(false)} className={`text-sm px-3 py-1 rounded-lg border transition-colors ${!useNewFolder ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'}`}>Existing</button>
            <button onClick={() => setUseNewFolder(true)} className={`text-sm px-3 py-1 rounded-lg border transition-colors ${useNewFolder ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'}`}>New folder</button>
          </div>
          {useNewFolder ? (
            <input type="text" value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="e.g. animals/cats" className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          ) : (
            <select value={folder} onChange={(e) => setFolder(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="uncategorized">uncategorized</option>
              {allFolderPaths.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          )}
        </div>

        <button
          onClick={() => { if (!selectedFiles.length) return; onClose(); onStartUpload(selectedFiles.map((f) => ({ ...f, folder: f.folder === 'uncategorized' ? activeFolder : f.folder }))); }}
          disabled={!selectedFiles.length}
          className="w-full py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          Upload {selectedFiles.length > 0 ? `${selectedFiles.length} file${selectedFiles.length !== 1 ? 's' : ''}` : 'files'}
        </button>
      </div>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {Array.from({ length: 8 }).map((_, i) => <div key={i} className="aspect-square bg-gray-200 rounded-xl animate-pulse" />)}
    </div>
  );
}

// ─── Main Gallery Client ───────────────────────────────────────────────────────

export function GalleryClient({ initialImages, initialFolders, initialMetadata, initialProjects, user }: Props) {
  const [images, setImages] = useState<GalleryImage[]>(initialImages);
  const [metadata, setMetadata] = useState<Record<string, ImageMetadata>>(initialMetadata);
  const [projects, setProjects] = useState<string[]>(initialProjects);
  // Extra folder paths (empty folders from server + newly created)
  const [extraFolderPaths, setExtraFolderPaths] = useState<string[]>(initialFolders);

  const [selectedFolder, setSelectedFolder] = useState('');
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Folder create dialog
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [createFolderParent, setCreateFolderParent] = useState<string | null>(null);

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

  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [imageToDelete, setImageToDelete] = useState<GalleryImage | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Share state
  const [shareFile, setShareFile] = useState<GalleryImage | null>(null);

  // My Shares panel
  const [showMyShares, setShowMyShares] = useState(false);
  const [myShares, setMyShares] = useState<Share[]>([]);
  const [loadingShares, setLoadingShares] = useState(false);

  // ── Derived state ──────────────────────────────────────────────────────────

  const folderTree = useMemo(
    () => buildFolderTree(images, extraFolderPaths),
    [images, extraFolderPaths]
  );

  const allFolderPaths = useMemo(() => {
    const paths = new Set(extraFolderPaths);
    for (const img of images) {
      const parts = img.key.split('/');
      const folderParts = parts.slice(1, -1);
      let current = '';
      for (const part of folderParts) {
        current = current ? `${current}/${part}` : part;
        paths.add(current);
      }
    }
    return Array.from(paths).sort();
  }, [images, extraFolderPaths]);

  const filteredImages = useMemo(() => {
    if (!selectedFolder) return images;
    return images.filter((img) => {
      const parts = img.key.split('/');
      const imgFolderPath = parts.slice(1, -1).join('/');
      return imgFolderPath === selectedFolder || imgFolderPath.startsWith(`${selectedFolder}/`);
    });
  }, [images, selectedFolder]);

  const isSearchMode = searchResults !== null;

  let displayImages = activeProject
    ? filteredImages.filter((img) => metadata[img.key]?.project === activeProject)
    : filteredImages;
  displayImages = sortImages(displayImages, sortBy, metadata);

  const searchImages_ = (searchResults || []).map((r) => ({
    key: r.key, url: r.url || '', size: r.size,
    lastModified: new Date(r.uploadedAt), folder: r.folder, filename: r.filename,
  }));
  // Lightbox only shows image files
  const lightboxImages = (isSearchMode ? searchImages_ : displayImages).filter((f) => isImageFile(f.filename));

  const projectCount = (p: string) => Object.values(metadata).filter((m) => m.project === p).length;

  // ── Toasts ─────────────────────────────────────────────────────────────────

  const addToast = useCallback((message: string, type: Toast['type']) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const removeToast = useCallback((id: number) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchImages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/images');
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

  const refreshFolders = useCallback(async () => {
    try {
      const res = await fetch('/api/folders');
      const data = await res.json();
      setExtraFolderPaths(data.folders || []);
    } catch { /* silent */ }
  }, []);

  // ── Upload ─────────────────────────────────────────────────────────────────

  const uploadFiles = useCallback(async (files: FileWithFolder[]) => {
    if (!files.length) return;
    setUploadProgress({ total: files.length, completed: 0, current: files[0].file.name, failed: [], isUploading: true });

    const failedNames: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const { file, folder } = files[i];
      setUploadProgress((prev) => prev ? { ...prev, current: file.name, completed: i } : null);

      // Client-side guard: large non-image files exceed Vercel's 4.5 MB serverless payload limit
      if (!isImageFile(file.name) && file.size > 4 * 1024 * 1024) {
        const msg = 'File too large for non-image uploads (max 4 MB)';
        console.warn(`[upload] ${file.name}: ${msg}`);
        failedNames.push(file.name);
        setUploadProgress((prev) => prev ? { ...prev, failed: [...prev.failed, file.name] } : null);
        continue;
      }

      try {
        const formData = new FormData();
        formData.append('files', file);
        formData.append('folder', folder);
        const res = await fetch('/api/images', { method: 'POST', body: formData });
        if (!res.ok) {
          let msg: string;
          if (res.status === 413) {
            msg = 'File too large (max ~4 MB per file on this plan)';
          } else {
            msg = `HTTP ${res.status}`;
            try {
              const body = await res.json();
              if (body.error) msg = body.error;
            } catch { /* ignore parse error */ }
          }
          console.error(`[upload] ${file.name}: ${msg}`);
          failedNames.push(file.name);
          setUploadProgress((prev) => prev ? { ...prev, failed: [...prev.failed, file.name] } : null);
        }
      } catch (err) {
        console.error(`[upload] ${file.name}: network error`, err);
        failedNames.push(file.name);
        setUploadProgress((prev) => prev ? { ...prev, failed: [...prev.failed, file.name] } : null);
      }
    }

    setUploadProgress((prev) => prev ? { ...prev, completed: files.length, isUploading: false } : null);

    if (failedNames.length > 0) {
      addToast(
        `${failedNames.length} file${failedNames.length > 1 ? 's' : ''} failed to upload`,
        'error'
      );
    } else {
      addToast(
        `${files.length} file${files.length > 1 ? 's' : ''} uploaded successfully`,
        'success'
      );
    }

    // Keep progress bar visible longer when there are failures
    const delay = failedNames.length > 0 ? 5000 : 1500;
    setTimeout(async () => {
      setUploadProgress(null);
      await fetchImages();
      await fetchMetadata();
      await refreshFolders();
    }, delay);
  }, [fetchImages, fetchMetadata, refreshFolders, addToast]);

  const prepareAndUpload = useCallback(async (newFiles: FileWithFolder[]) => {
    const existingNames = new Set(
      images.map((img) => displayName(img.filename).toLowerCase())
    );
    const toUpload: FileWithFolder[] = [];
    const dupes: string[] = [];
    for (const item of newFiles) {
      if (existingNames.has(item.file.name.toLowerCase())) {
        dupes.push(displayName(item.file.name));
      } else {
        toUpload.push(item);
      }
    }
    if (dupes.length > 0) {
      addToast(
        dupes.length === 1
          ? `"${dupes[0]}" already exists — skipped`
          : `${dupes.length} files already exist — skipped`,
        'error'
      );
    }
    if (toUpload.length > 0) {
      await uploadFiles(toUpload);
    }
  }, [images, uploadFiles, addToast]);

  // ── Drag & drop ────────────────────────────────────────────────────────────

  const handlePageDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) setIsDragging(true);
  }, []);

  const handlePageDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragging(false);
  }, []);

  const handlePageDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); }, []);

  const handlePageDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    dragCounterRef.current = 0;

    const items = e.dataTransfer.items;
    const files: FileWithFolder[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind !== 'file') continue;
      const entry = item.webkitGetAsEntry?.();
      if (entry?.isDirectory) {
        const sub = await readDirectory(entry as FileSystemDirectoryEntry, entry.name);
        files.push(...sub);
      } else {
        const file = item.getAsFile();
        if (file) files.push({ file, folder: selectedFolder || 'uncategorized' });
      }
    }
    if (files.length > 0) prepareAndUpload(files);
  }, [selectedFolder, prepareAndUpload]);

  // ── Delete ─────────────────────────────────────────────────────────────────

  const requestDelete = useCallback((image: GalleryImage) => {
    setImageToDelete(image);
    setShowDeleteConfirm(true);
  }, []);

  const executeDelete = useCallback(async () => {
    if (!imageToDelete) return;
    setDeleting(true);
    const key = imageToDelete.key;
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    try {
      const res = await fetch(`/api/images/${encodedKey}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setImages((prev) => prev.filter((img) => img.key !== key));
      setMetadata((prev) => { const n = { ...prev }; delete n[key]; return n; });
      setSearchResults((prev) => prev?.filter((r) => r.key !== key) || null);
      if (lightboxIndex !== null) setLightboxIndex(null);
      setShowDeleteConfirm(false);
      setImageToDelete(null);
      addToast('Image deleted', 'success');
    } catch {
      addToast('Failed to delete image', 'error');
    } finally {
      setDeleting(false);
    }
  }, [imageToDelete, lightboxIndex, addToast]);

  const handleBulkDelete = useCallback(async () => {
    const keys = Array.from(selectedKeys);
    let failed = 0;
    for (const key of keys) {
      try {
        const encodedKey = key.split('/').map(encodeURIComponent).join('/');
        const res = await fetch(`/api/images/${encodedKey}`, { method: 'DELETE' });
        if (res.ok) {
          setImages((prev) => prev.filter((img) => img.key !== key));
          setMetadata((prev) => { const n = { ...prev }; delete n[key]; return n; });
        } else { failed++; }
      } catch { failed++; }
    }
    setSelectedKeys(new Set());
    setSelectMode(false);
    addToast(failed > 0 ? `Deleted with ${failed} failure(s)` : `Deleted ${keys.length} image${keys.length !== 1 ? 's' : ''}`, failed > 0 ? 'error' : 'success');
  }, [selectedKeys, addToast]);

  // ── Folder actions ─────────────────────────────────────────────────────────

  const handleFolderSelect = (path: string) => {
    setSelectedFolder(path);
    setSearchQuery('');
    setSearchResults(null);
    setActiveProject(null);
    setLightboxIndex(null);
    // Auto-close sidebar on mobile where it renders as a fixed overlay
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  const handleCreateSubfolder = (parentPath: string) => {
    setCreateFolderParent(parentPath);
    setShowCreateFolder(true);
  };

  const handleCreateFolder = async (name: string) => {
    const folderPath = createFolderParent ? `${createFolderParent}/${name}` : name;
    try {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: folderPath }),
      });
      if (!res.ok) {
        const d = await res.json();
        addToast(d.error || 'Failed to create folder', 'error');
        return;
      }
      setExtraFolderPaths((prev) => [...new Set([...prev, folderPath])]);
      setSelectedFolder(folderPath);
      setShowCreateFolder(false);
      setCreateFolderParent(null);
      addToast(`Folder "${folderPath}" created`, 'success');
    } catch {
      addToast('Failed to create folder', 'error');
    }
  };

  const handleRenameFolder = useCallback(async (oldPath: string, newName: string) => {
    try {
      const res = await fetch('/api/folders/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath, newName }),
      });
      if (!res.ok) {
        const d = await res.json();
        addToast(d.error || 'Failed to rename', 'error');
        return;
      }
      const data = await res.json();
      const newPath: string = data.renamed.to;
      if (selectedFolder === oldPath || selectedFolder.startsWith(`${oldPath}/`)) {
        setSelectedFolder(newPath);
      }
      addToast(`Renamed to "${newName}"`, 'success');
      await Promise.all([fetchImages(), fetchMetadata(), refreshFolders()]);
    } catch {
      addToast('Failed to rename folder', 'error');
    }
  }, [addToast, selectedFolder, fetchImages, fetchMetadata, refreshFolders]);

  const handleDeleteFolder = useCallback(async (path: string) => {
    try {
      const res = await fetch(`/api/folders?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json();
        addToast(d.error || 'Failed to delete folder', 'error');
        return;
      }
      if (selectedFolder === path || selectedFolder.startsWith(`${path}/`)) setSelectedFolder('');
      setExtraFolderPaths((prev) => prev.filter((p) => p !== path && !p.startsWith(`${path}/`)));
      addToast('Folder deleted', 'success');
    } catch {
      addToast('Failed to delete folder', 'error');
    }
  }, [addToast, selectedFolder]);

  // ── Other handlers ─────────────────────────────────────────────────────────

  const handleSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setSearchResults(null); return; }
    setSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setSearchResults((data.results || []).map((r: ImageMetadata) => ({
        ...r, url: images.find((img) => img.key === r.key)?.url,
      })));
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

  const handleAssignProject = useCallback(async (key: string, project: string) => {
    try {
      await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys: [key], project }) });
      setMetadata((prev) => ({ ...prev, [key]: { ...prev[key], project } }));
      await fetchProjects();
      addToast(`Assigned to "${project}"`, 'success');
    } catch {
      addToast('Failed to assign project', 'error');
    }
  }, [addToast, fetchProjects]);

  const handleMoveFolder = useCallback(async (key: string, targetFolder: string) => {
    try {
      const res = await fetch('/api/images/move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys: [key], targetFolder }) });
      if (!res.ok) throw new Error();
      const { moved } = await res.json() as { moved: { oldKey: string; newKey: string }[] };
      if (moved.length > 0) {
        const { oldKey, newKey } = moved[0];
        setImages((prev) => prev.map((img) => img.key === oldKey ? { ...img, key: newKey, folder: targetFolder } : img));
        setMetadata((prev) => {
          const next = { ...prev };
          if (next[oldKey]) { next[newKey] = { ...next[oldKey], key: newKey, folder: targetFolder }; delete next[oldKey]; }
          return next;
        });
        setLightboxIndex(null);
      }
      addToast(`Moved to "${targetFolder}"`, 'success');
    } catch {
      addToast('Failed to move image', 'error');
    }
  }, [addToast]);

  const handleLogout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }, []);

  const handleShareImage = useCallback((image: GalleryImage) => {
    setShareFile(image);
  }, []);

  const handleShareFolder = useCallback((_folderPath: string) => {
    // Folder sharing not supported in new share system
  }, []);

  const fetchMyShares = useCallback(async () => {
    setLoadingShares(true);
    try {
      const res = await fetch('/api/shares');
      const data = await res.json();
      setMyShares(data.shares || []);
    } catch { /* silent */ } finally {
      setLoadingShares(false);
    }
  }, []);

  const handleOpenMyShares = useCallback(async () => {
    setShowMyShares(true);
    await fetchMyShares();
  }, [fetchMyShares]);

  const handleRevokeShare = useCallback(async (id: string) => {
    await fetch(`/api/shares?id=${id}`, { method: 'DELETE' });
    setMyShares((prev) => prev.filter((s) => s.id !== id));
  }, []);


  const handleFileClick = useCallback((file: GalleryImage) => {
    if (isImageFile(file.filename)) {
      const idx = lightboxImages.findIndex((img) => img.key === file.key);
      if (idx !== -1) setLightboxIndex(idx);
    } else if (file.filename.toLowerCase().endsWith('.pdf')) {
      window.open(file.url, '_blank');
    } else {
      const a = document.createElement('a');
      a.href = file.url;
      a.download = file.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }, [lightboxImages]);

  const toggleSelect = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col h-screen"
      onDragEnter={handlePageDragEnter}
      onDragLeave={handlePageDragLeave}
      onDragOver={handlePageDragOver}
      onDrop={handlePageDrop}
    >
      {/* User header bar */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          {/* Mobile sidebar toggle */}
          <button onClick={() => setSidebarOpen((v) => !v)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 transition-colors md:hidden" title="Toggle folders">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0">
            {user?.displayName?.charAt(0)?.toUpperCase() || 'U'}
          </div>
          <span className="text-sm text-gray-700 font-medium hidden sm:block">{user?.displayName || 'User'}</span>
          {user?.role === 'admin' && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full hidden sm:block">admin</span>}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleOpenMyShares}
            className="text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1 transition-colors"
            title="My shared links"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
            <span className="hidden sm:block">Shares</span>
          </button>
          {user?.role === 'admin' && (
            <a href="/settings" className="text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1 transition-colors">
              <SettingsIcon /> <span className="hidden sm:block">Settings</span>
            </a>
          )}
          <button onClick={handleLogout} className="text-sm text-gray-500 hover:text-red-600 flex items-center gap-1 transition-colors">
            <LogoutIcon /> <span className="hidden sm:block">Logout</span>
          </button>
        </div>
      </div>

      {/* Main layout: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">

        {/* Mobile sidebar backdrop */}
        {sidebarOpen && (
          <div className="fixed inset-0 bg-black/30 z-20 md:hidden" onClick={() => setSidebarOpen(false)} />
        )}

        {/* Sidebar */}
        <aside className={`
          ${sidebarOpen ? 'flex' : 'hidden'}
          fixed md:relative
          left-0 top-0 md:top-auto
          h-full md:h-auto
          w-64 md:w-56
          z-30 md:z-auto
          bg-white border-r border-gray-200
          flex-col flex-shrink-0
          shadow-xl md:shadow-none
        `}>
          {/* Sidebar header */}
          <div className="px-3 py-2.5 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
            <span className="text-sm font-semibold text-gray-700">Folders</span>
            <button
              onClick={() => { setCreateFolderParent(null); setShowCreateFolder(true); }}
              className="p-1 hover:bg-gray-100 rounded-lg text-gray-500 hover:text-gray-700 transition-colors"
              title="New folder"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                <line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>
              </svg>
            </button>
          </div>

          {/* Folder tree */}
          <div className="flex-1 overflow-y-auto py-1">
            <FolderTreeItem
              node={folderTree}
              selectedPath={selectedFolder}
              onSelect={handleFolderSelect}
              onCreateSubfolder={handleCreateSubfolder}
              onRename={handleRenameFolder}
              onDelete={handleDeleteFolder}
              onShare={handleShareFolder}
              depth={0}
              isRoot
            />
          </div>

          {/* Hide sidebar button */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="px-3 py-2.5 border-t border-gray-100 text-sm text-gray-400 hover:bg-gray-50 flex items-center gap-2 flex-shrink-0 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/>
            </svg>
            Hide sidebar
          </button>
        </aside>

        {/* Show sidebar button (when hidden, desktop only) */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="hidden md:flex fixed left-0 bottom-20 bg-white border border-l-0 border-gray-200 rounded-r-xl px-2 py-3 shadow-md hover:bg-gray-50 z-20 items-center"
            title="Show folders"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/>
            </svg>
          </button>
        )}

        {/* Content area */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-4 max-w-6xl">

            {/* Gallery header */}
            <header className="flex items-center justify-between mb-4">
              <div>
                <h1 className="text-xl font-bold text-gray-900">
                  {selectedFolder ? selectedFolder.split('/').pop() : 'All Files'}
                </h1>
                <p className="text-xs text-gray-400 mt-0.5">
                  {isSearchMode ? `${searchResults!.length} search results` : `${filteredImages.length} file${filteredImages.length !== 1 ? 's' : ''}`}
                  {selectedFolder && !isSearchMode && ` in ${selectedFolder}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setSelectMode((v) => !v); setSelectedKeys(new Set()); }}
                  className={`px-3 py-2 rounded-xl text-sm font-medium border transition-colors ${selectMode ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                  title="Select files"
                >
                  ☑
                </button>
                {/* View toggle */}
                <div className="flex border border-gray-200 rounded-xl overflow-hidden">
                  <button onClick={() => setViewMode('grid')} className={`p-2 transition-colors ${viewMode === 'grid' ? 'bg-blue-50 text-blue-600' : 'text-gray-400 hover:text-gray-600'}`} title="Grid view">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
                      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
                    </svg>
                  </button>
                  <button onClick={() => setViewMode('list')} className={`p-2 transition-colors ${viewMode === 'list' ? 'bg-blue-50 text-blue-600' : 'text-gray-400 hover:text-gray-600'}`} title="List view">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                      <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
                    </svg>
                  </button>
                </div>
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortOption)} className="text-sm px-3 py-2 border border-gray-200 rounded-xl bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 hidden sm:block">
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="name-asc">Name A–Z</option>
                  <option value="category">Category</option>
                  <option value="style">Style</option>
                </select>
                <button onClick={() => setShowUpload(true)} className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors shadow-sm text-sm">
                  <span className="text-base leading-none">+</span> Upload
                </button>
              </div>
            </header>

            {/* Search */}
            <div className="relative mb-4">
              <input type="text" value={searchQuery} onChange={(e) => onSearchChange(e.target.value)} placeholder="Search by tags, description, category, filename..." className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
              {searchQuery && <button onClick={() => { setSearchQuery(''); setSearchResults(null); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg">×</button>}
            </div>

            {/* Project filter */}
            {!isSearchMode && projects.length > 0 && (
              <div className="flex gap-2 flex-wrap mb-4 items-center">
                <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">Projects:</span>
                {activeProject && <button onClick={() => setActiveProject(null)} className="px-3 py-1 rounded-full text-xs bg-gray-100 text-gray-500 hover:bg-gray-200">All</button>}
                {projects.map((p) => (
                  <button key={p} onClick={() => setActiveProject(activeProject === p ? null : p)} className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${activeProject === p ? 'bg-purple-600 text-white' : 'bg-purple-100 text-purple-700 hover:bg-purple-200'}`}>
                    {p} ({projectCount(p)})
                  </button>
                ))}
              </div>
            )}

            {/* File list/grid */}
            {searching || loading ? <SkeletonGrid />
              : (() => {
                const activeFiles = isSearchMode ? searchImages_ : displayImages;
                if (activeFiles.length === 0) return (
                  <div className="flex flex-col items-center justify-center py-24 text-gray-400">
                    <div className="text-5xl mb-4">{isSearchMode ? '🔍' : '📁'}</div>
                    <p className="text-lg font-medium">{isSearchMode ? `No results for "${searchQuery}"` : 'No files here'}</p>
                    {!isSearchMode && <><p className="text-sm mt-1">Upload files or drag & drop here</p>
                      <button onClick={() => setShowUpload(true)} className="mt-6 px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors">Upload first file</button></>}
                  </div>
                );

                if (viewMode === 'list') return (
                  <div className="space-y-0.5">
                    {activeFiles.map((file) => {
                      const { kind, color } = getFileKind(file.filename);
                      const ext = file.filename.split('.').pop() || '';
                      return (
                        <div
                          key={file.key}
                          className={`flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 rounded-xl cursor-pointer group transition-colors ${selectedKeys.has(file.key) && selectMode ? 'bg-blue-50' : ''}`}
                          onClick={() => selectMode ? toggleSelect(file.key) : handleFileClick(file)}
                        >
                          {selectMode && (
                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${selectedKeys.has(file.key) ? 'bg-blue-600 border-blue-600' : 'border-gray-300'}`}>
                              {selectedKeys.has(file.key) && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                            </div>
                          )}
                          {kind === 'image' ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={file.url} alt="" className="w-10 h-10 object-cover rounded-lg flex-shrink-0" />
                          ) : (
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
                              <FileTypeIcon ext={ext} />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate" title={displayName(file.filename)}>{displayName(file.filename)}</p>
                            <p className="text-xs text-gray-400">{file.folder} · {formatBytes(file.size)}</p>
                          </div>
                          <span className="text-xs text-gray-400 shrink-0 hidden sm:block" suppressHydrationWarning>
                            {new Date(file.lastModified).toLocaleDateString()}
                          </span>
                          {!selectMode && (
                            <div className="flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all shrink-0">
                              <button onClick={(e) => { e.stopPropagation(); handleShareImage(file); }} className="min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center p-1.5 hover:bg-blue-100 text-gray-500 hover:text-blue-600 rounded-lg transition-colors" title="Share">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); requestDelete(file); }} className="min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center p-1.5 hover:bg-red-100 text-gray-500 hover:text-red-600 rounded-lg transition-colors" title="Delete">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );

                const imgFiles = activeFiles.filter(f => isImageFile(f.filename));
                const docFiles = activeFiles.filter(f => !isImageFile(f.filename));
                return (
                  <>
                    {/* MOBILE (< md): doc rows above image 2-col grid */}
                    <div className="md:hidden space-y-4">
                      {docFiles.length > 0 && (
                        <div className="space-y-0.5">
                          {docFiles.map((file) => {
                            const { color } = getFileKind(file.filename);
                            const ext = file.filename.split('.').pop() || '';
                            return (
                              <div
                                key={file.key}
                                className={`flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 rounded-xl cursor-pointer group transition-colors ${selectedKeys.has(file.key) && selectMode ? 'bg-blue-50' : ''}`}
                                onClick={() => selectMode ? toggleSelect(file.key) : handleFileClick(file)}
                              >
                                {selectMode && (
                                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${selectedKeys.has(file.key) ? 'bg-blue-600 border-blue-600' : 'border-gray-300'}`}>
                                    {selectedKeys.has(file.key) && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                                  </div>
                                )}
                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
                                  <FileTypeIcon ext={ext} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-gray-800 truncate" title={displayName(file.filename)}>{displayName(file.filename)}</p>
                                  <p className="text-xs text-gray-400">{file.folder} · {formatBytes(file.size)}</p>
                                </div>
                                {!selectMode && (
                                  <div className="flex gap-1 shrink-0">
                                    <button onClick={(e) => { e.stopPropagation(); handleShareImage(file); }} className="min-w-[44px] min-h-[44px] flex items-center justify-center p-1.5 hover:bg-blue-100 text-gray-500 hover:text-blue-600 rounded-lg transition-colors" title="Share">
                                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                                    </button>
                                    <button onClick={(e) => { e.stopPropagation(); requestDelete(file); }} className="min-w-[44px] min-h-[44px] flex items-center justify-center p-1.5 hover:bg-red-100 text-gray-500 hover:text-red-600 rounded-lg transition-colors" title="Delete">
                                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {imgFiles.length > 0 && (
                        <div className="grid grid-cols-2 gap-3">
                          {imgFiles.map((file) => (
                            <FileCard key={file.key} file={file} meta={metadata[file.key]} selectMode={selectMode} selected={selectedKeys.has(file.key)} onToggleSelect={toggleSelect} onDeleteRequest={requestDelete} onShareRequest={handleShareImage} onClick={() => handleFileClick(file)} />
                          ))}
                        </div>
                      )}
                    </div>

                    {/* DESKTOP (≥ md): all files as grid cards — FileCard handles both image and doc styles */}
                    <div className="hidden md:grid md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                      {activeFiles.map((file) => (
                        <FileCard key={file.key} file={file} meta={metadata[file.key]} selectMode={selectMode} selected={selectedKeys.has(file.key)} onToggleSelect={toggleSelect} onDeleteRequest={requestDelete} onShareRequest={handleShareImage} onClick={() => handleFileClick(file)} />
                      ))}
                    </div>
                  </>
                );
              })()
            }
          </div>
        </div>
      </div>

      {/* ── Fixed UI & Overlays ── */}

      {/* Drag overlay */}
      {isDragging && (
        <div className="fixed inset-0 bg-blue-500/10 border-4 border-dashed border-blue-500 z-40 flex items-center justify-center pointer-events-none">
          <div className="bg-white rounded-2xl p-8 shadow-xl text-center">
            <span className="text-blue-500 flex justify-center mb-4"><UploadIcon /></span>
            <p className="text-lg font-semibold text-gray-800">Drop any files or folders here</p>
            <p className="text-sm text-gray-500 mt-1">{selectedFolder ? `→ ${selectedFolder}` : '→ uncategorized'}</p>
          </div>
        </div>
      )}

      {/* Upload progress */}
      {uploadProgress && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-40 px-6 py-4">
          <div className="max-w-2xl mx-auto">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-gray-800">
                {uploadProgress.isUploading
                  ? `Uploading file ${uploadProgress.completed + 1} of ${uploadProgress.total}`
                  : uploadProgress.failed.length > 0
                  ? `Done — ${uploadProgress.failed.length} of ${uploadProgress.total} failed`
                  : `${uploadProgress.total} file${uploadProgress.total !== 1 ? 's' : ''} uploaded`}
              </span>
              {uploadProgress.isUploading && (
                <span className="text-xs text-gray-400 truncate max-w-[200px] ml-4" title={uploadProgress.current}>
                  {uploadProgress.current}
                </span>
              )}
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${uploadProgress.failed.length > 0 ? 'bg-amber-500' : 'bg-blue-600'}`}
                style={{ width: `${Math.round(((uploadProgress.isUploading ? uploadProgress.completed : uploadProgress.total) / uploadProgress.total) * 100)}%` }}
              />
            </div>
            {uploadProgress.failed.length > 0 && (
              <p className="text-xs text-red-500 mt-1.5 truncate" title={uploadProgress.failed.join(', ')}>
                Failed: {uploadProgress.failed.join(', ')}
              </p>
            )}
            {!uploadProgress.isUploading && uploadProgress.failed.length === 0 && (
              <div className="flex items-center gap-1.5 mt-1.5 text-green-600">
                <CheckIcon /><span className="text-sm font-medium">Complete!</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bulk select action bar */}
      {selectMode && selectedKeys.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-white rounded-full shadow-lg border border-gray-200 px-6 py-3 flex items-center gap-4 z-40">
          <span className="text-sm font-medium text-gray-800">{selectedKeys.size} selected</span>
          <button onClick={handleBulkDelete} className="px-4 py-1.5 bg-red-500 text-white rounded-full text-sm font-medium hover:bg-red-600 transition-colors">Delete</button>
          <button onClick={() => { setSelectMode(false); setSelectedKeys(new Set()); }} className="px-4 py-1.5 text-gray-600 text-sm hover:text-gray-800 transition-colors">Cancel</button>
        </div>
      )}

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <Lightbox
          images={lightboxImages}
          index={lightboxIndex}
          meta={metadata}
          projects={projects}
          allFolderPaths={allFolderPaths}
          onClose={() => setLightboxIndex(null)}
          onPrev={() => setLightboxIndex((i) => (i !== null && i > 0 ? i - 1 : i))}
          onNext={() => setLightboxIndex((i) => (i !== null && i < lightboxImages.length - 1 ? i + 1 : i))}
          onAssignProject={handleAssignProject}
          onMoveFolder={handleMoveFolder}
          onDeleteRequest={requestDelete}
        />
      )}

      {/* Upload modal */}
      {showUpload && (
        <UploadModal
          allFolderPaths={allFolderPaths}
          defaultFolder={selectedFolder}
          onClose={() => setShowUpload(false)}
          onStartUpload={(files) => { setShowUpload(false); prepareAndUpload(files); }}
        />
      )}

      {/* Create folder modal */}
      {showCreateFolder && (
        <CreateFolderModal
          parentPath={createFolderParent}
          onConfirm={handleCreateFolder}
          onCancel={() => { setShowCreateFolder(false); setCreateFolderParent(null); }}
        />
      )}

      {/* Chat */}
      {showChat && <ChatPanel onClose={() => setShowChat(false)} images={images} />}

      <button
        onClick={() => setShowChat((v) => !v)}
        className={`fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all z-30 ${showChat ? 'bg-gray-800 hover:bg-gray-900 text-white text-xl' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
        title="Gallery Assistant"
      >
        {showChat ? '×' : <ChatIcon />}
      </button>

      {/* Delete confirmation */}
      {showDeleteConfirm && imageToDelete && (
        <DeleteConfirmModal
          image={imageToDelete}
          deleting={deleting}
          onConfirm={executeDelete}
          onCancel={() => { setShowDeleteConfirm(false); setImageToDelete(null); }}
        />
      )}

      {/* Share modal */}
      {shareFile && (
        <ShareModal
          file={shareFile}
          onClose={() => setShareFile(null)}
        />
      )}

      {/* My Shares panel */}
      {showMyShares && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]" onClick={() => setShowMyShares(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full mx-4 shadow-xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4 flex-shrink-0">
              <h3 className="text-lg font-semibold">My Shared Links</h3>
              <button onClick={() => setShowMyShares(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="overflow-y-auto flex-1">
              {loadingShares ? (
                <div className="flex justify-center py-8">
                  <div className="w-6 h-6 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
                </div>
              ) : myShares.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-8">No active share links</p>
              ) : (
                <div className="space-y-2">
                  {myShares.map((s) => (
                    <div key={s.id} className="flex items-center gap-3 px-3 py-2.5 bg-gray-50 rounded-xl">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${s.mode === 'preview' ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>
                        {s.mode === 'preview' ? (
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{s.fileName}</p>
                        <p className="text-xs text-gray-400 capitalize">{s.mode} · {s.viewCount} view{s.viewCount !== 1 ? 's' : ''}</p>
                      </div>
                      <button
                        onClick={async () => {
                          const base = process.env.NEXT_PUBLIC_BASE_URL || window.location.origin;
                          await navigator.clipboard.writeText(`${base}/share/${s.id}`);
                          addToast('Link copied!', 'success');
                        }}
                        className="p-1.5 hover:bg-gray-200 rounded-lg transition-colors text-gray-500"
                        title="Copy link"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                      </button>
                      <button
                        onClick={() => handleRevokeShare(s.id)}
                        className="p-1.5 hover:bg-red-100 text-gray-400 hover:text-red-600 rounded-lg transition-colors"
                        title="Delete"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <ToastList toasts={toasts} onRemove={removeToast} />
    </div>
  );
}

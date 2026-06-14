import { getShareById, isShareExpired } from '@/lib/shares';
import { ProtectedImageViewer } from '@/components/ProtectedImageViewer';
import { ProtectedVideoPlayer } from '@/components/ProtectedVideoPlayer';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  return { robots: 'noindex, nofollow' };
}

interface Props {
  params: Promise<{ id: string }>;
}

export default async function SharePage({ params }: Props) {
  const { id } = await params;
  const share = await getShareById(id);

  if (!share) notFound();

  if (isShareExpired(share)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-5xl mb-4">🔗</div>
          <h1 className="text-xl font-semibold text-gray-800 mb-2">Link expired</h1>
          <p className="text-gray-500 text-sm">This link has expired or doesn&apos;t exist.</p>
        </div>
      </div>
    );
  }

  const isPreview = share.mode === 'preview';
  const isImage = share.fileType === 'image';
  const isVideo = share.fileType === 'video';
  const watermarkText = `Shared by ${share.createdByName}`;

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Header */}
      <header className="bg-gray-900 border-b border-white/10 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-400">
            <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
          </svg>
          <span className="text-white font-semibold text-sm">AK Storage</span>
        </div>
        <div className="flex items-center gap-2">
          {isPreview ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 bg-purple-900/50 border border-purple-500/30 text-purple-300 text-xs rounded-full">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
              </svg>
              Preview only
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-900/50 border border-blue-500/30 text-blue-300 text-xs rounded-full">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"/>
              </svg>
              Download
            </span>
          )}
          <span className="text-white/40 text-xs">Shared by {share.createdByName}</span>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col items-center justify-center p-4 md:p-8">
        <div className="w-full max-w-4xl flex flex-col items-center gap-6">

          {/* Title */}
          <div className="text-center">
            <h1 className="text-white font-semibold text-lg">
              {isPreview ? '👁 Preview — ' : '📥 '}{share.fileName}
            </h1>
            {share.expiresAt && (
              <p className="text-white/40 text-xs mt-1">
                Expires {new Date(share.expiresAt).toLocaleDateString()}
              </p>
            )}
          </div>

          {/* Preview mode — image */}
          {isPreview && isImage && (
            <ProtectedImageViewer
              shareId={id}
              watermarkText={watermarkText}
            />
          )}

          {/* Preview mode — video */}
          {isPreview && isVideo && (
            <ProtectedVideoPlayer
              shareId={id}
              watermarkText={watermarkText}
            />
          )}

          {/* Preview mode — document: preview not supported, offer download anyway */}
          {isPreview && !isImage && !isVideo && (
            <div className="flex flex-col items-center gap-6 py-8">
              <svg className="w-20 h-20 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              <p className="text-white/60 text-sm">{share.fileName}</p>
              <p className="text-white/30 text-xs">This file type cannot be previewed in the browser</p>
            </div>
          )}

          {/* Download mode — image */}
          {!isPreview && isImage && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/share/${id}/file`}
                alt={share.fileName}
                className="max-w-full max-h-[70vh] rounded-xl shadow-2xl object-contain"
              />
              <a
                href={`/api/share/${id}/file?download=1`}
                download={share.fileName}
                className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-colors shadow-lg"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"/>
                </svg>
                Download
              </a>
            </>
          )}

          {/* Download mode — video */}
          {!isPreview && isVideo && (
            <>
              <video
                src={`/api/share/${id}/file`}
                controls
                className="max-w-full max-h-[70vh] rounded-xl shadow-2xl"
              />
              <a
                href={`/api/share/${id}/file?download=1`}
                download={share.fileName}
                className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-colors shadow-lg"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"/>
                </svg>
                Download
              </a>
            </>
          )}

          {/* Download mode — document / PDF */}
          {!isPreview && !isImage && !isVideo && (
            <div className="flex flex-col items-center gap-6 py-8">
              <svg className="w-20 h-20 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              <p className="text-white/70 text-sm font-medium">{share.fileName}</p>
              <a
                href={`/api/share/${id}/file?download=1`}
                download={share.fileName}
                className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-colors shadow-lg"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"/>
                </svg>
                Download {share.fileName}
              </a>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-gray-900 border-t border-white/10 px-6 py-3 flex items-center justify-center flex-shrink-0">
        {isPreview ? (
          <p className="text-white/30 text-xs">This content is protected and cannot be downloaded</p>
        ) : (
          <p className="text-white/30 text-xs">{share.fileName}</p>
        )}
      </footer>
    </div>
  );
}

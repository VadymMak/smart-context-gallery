import { getShareById, isShareExpired } from '@/lib/shares';
import { ProtectedImageViewer } from '@/components/ProtectedImageViewer';
import { ProtectedVideoPlayer } from '@/components/ProtectedVideoPlayer';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  return {
    robots: 'noindex',
  };
}

interface Props {
  params: Promise<{ id: string }>;
}

export default async function SharePage({ params }: Props) {
  const { id } = await params;
  const share = await getShareById(id);

  if (!share) notFound();

  const expired = isShareExpired(share);

  if (expired) {
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

  const watermark = share.watermarkText || `Shared by ${share.createdByName}`;
  const isDownload = share.mode === 'download';
  const isImage = share.fileType === 'image';
  const isVideo = share.fileType === 'video';

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Header */}
      <header className="bg-gray-900 border-b border-white/10 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400">
            <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
          </svg>
          <span className="text-white font-semibold text-sm">AK Storage</span>
        </div>
        <span className="text-white/50 text-sm">Shared by {share.createdByName}</span>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col items-center justify-center p-4 md:p-8">
        <div className="w-full max-w-4xl">
          {isImage && isDownload && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/share/${id}/file`}
              alt={share.fileName}
              className="w-full h-auto rounded-xl shadow-2xl"
            />
          )}

          {isImage && !isDownload && (
            <ProtectedImageViewer
              shareId={id}
              watermarkText={watermark}
              fileName={share.fileName}
            />
          )}

          {isVideo && isDownload && (
            <video
              src={`/api/share/${id}/file`}
              controls
              className="w-full max-h-[80vh] rounded-xl shadow-2xl"
            />
          )}

          {isVideo && !isDownload && (
            <ProtectedVideoPlayer
              shareId={id}
              watermarkText={watermark}
              fileName={share.fileName}
            />
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-gray-900 border-t border-white/10 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div>
          <p className="text-white/80 text-sm font-medium">{share.fileName}</p>
          {share.expiresAt && (
            <p className="text-white/40 text-xs mt-0.5">
              Expires {new Date(share.expiresAt).toLocaleDateString()}
            </p>
          )}
        </div>
        {isDownload && (
          <a
            href={`/api/share/${id}/file`}
            download={share.fileName}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Download
          </a>
        )}
      </footer>
    </div>
  );
}

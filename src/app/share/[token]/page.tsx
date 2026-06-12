import { getShare, incrementAccessCount } from '@/lib/shares';
import { r2, BUCKET } from '@/lib/r2';
import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { notFound } from 'next/navigation';
import { ShareGalleryClient } from '@/components/ShareGalleryClient';

export const dynamic = 'force-dynamic';

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.heic'];

interface Props {
  params: Promise<{ token: string }>;
}

export default async function SharePage({ params }: Props) {
  const { token } = await params;
  const share = await getShare(token);

  if (!share) notFound();

  await incrementAccessCount(token);

  if (share.type === 'image') {
    const url = await getSignedUrl(
      r2,
      new GetObjectCommand({ Bucket: BUCKET, Key: share.target }),
      { expiresIn: 3600 }
    );

    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="max-w-4xl w-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={share.label || 'Shared image'}
            className="w-full h-auto rounded-lg shadow-2xl"
          />
          <div className="mt-4 text-center">
            <p className="text-white/80 text-sm">
              {share.label || 'Shared from AK Gallery'}
            </p>
            <p className="text-white/40 text-xs mt-1">
              Shared by {share.userName} · Expires {new Date(share.expiresAt).toLocaleDateString()}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (share.type === 'folder') {
    const prefix = `${share.userId}/${share.target}/`;
    const command = new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix });
    const response = await r2.send(command);
    const objects = response.Contents || [];

    const images = await Promise.all(
      objects
        .filter((obj) => {
          if (!obj.Key || obj.Key.endsWith('/')) return false;
          const ext = obj.Key.toLowerCase().split('.').pop();
          return ext !== undefined && IMAGE_EXTENSIONS.includes(`.${ext}`);
        })
        .map(async (obj) => ({
          key: obj.Key!,
          url: await getSignedUrl(
            r2,
            new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key! }),
            { expiresIn: 3600 }
          ),
          filename: obj.Key!.split('/').pop()!,
        }))
    );

    return (
      <div className="min-h-screen bg-gray-50">
        <ShareGalleryClient
          images={images}
          title={share.label || share.target.split('/').pop() || 'Shared folder'}
          sharedBy={share.userName}
          expiresAt={share.expiresAt}
          token={token}
        />
      </div>
    );
  }

  notFound();
}

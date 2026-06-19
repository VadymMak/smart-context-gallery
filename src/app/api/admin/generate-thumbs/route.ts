import { NextRequest } from 'next/server';
import { ListObjectsV2Command, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { r2, BUCKET } from '@/lib/r2';
import { getCurrentUser } from '@/lib/auth';
import { extractRawThumbnail, toWebpThumb, toWebpPreview } from '@/lib/raw-thumb';

export const maxDuration = 300;

const RAW_EXT = /\.(cr2|cr3|nef|arw|dng|raf|rw2|orf|pef)$/i;

function toArrayBuffer(u8: Uint8Array<ArrayBufferLike>): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret');
  const secretOk = process.env.ADMIN_SECRET && secret === process.env.ADMIN_SECRET;

  const user = await getCurrentUser();
  const sessionOk = !!user && user.role === 'admin';

  if (!secretOk && !sessionOk) {
    return new Response('Forbidden', { status: 403 });
  }

  // userId: from query param, then session, then all-bucket scan (no prefix)
  const userIdParam = req.nextUrl.searchParams.get('userId');
  const userId = userIdParam ?? user?.id ?? null;
  const force = req.nextUrl.searchParams.get('force') === 'true';

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (msg: string) => controller.enqueue(enc.encode(msg + '\n'));

      try {
        const prefix = userId ? `${userId}/` : '';
        send(prefix
          ? `Listing RAW files for userId: ${userId} ...`
          : 'Listing ALL RAW files in bucket ...'
        );

        // ── List all RAW files in R2 ─────────────────────────────────────────
        const allKeys: string[] = [];
        let token: string | undefined;
        do {
          const list = await r2.send(new ListObjectsV2Command({
            Bucket: BUCKET,
            Prefix: prefix || undefined,
            ContinuationToken: token,
          }));
          for (const obj of list.Contents ?? []) {
            if (obj.Key && RAW_EXT.test(obj.Key)) {
              allKeys.push(obj.Key);
            }
          }
          token = list.NextContinuationToken;
        } while (token);

        send(`Found ${allKeys.length} RAW files. Starting thumbnail generation${force ? ' (force mode)' : ''}...`);

        let done = 0, skipped = 0, errors = 0;

        for (const key of allKeys) {
          const thumbKey   = `_thumbs/${key}.webp`;
          const previewKey = `_previews/${key}.webp`;
          const rawKey     = `_raws/${key}.jpg`;

          // Skip if all 3 versions already cached (unless force=true)
          if (!force) {
            const head = (k: string) => r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: k })).then(() => true).catch(() => false);
            const [hasThumb, hasPreview, hasRaw] = await Promise.all([head(thumbKey), head(previewKey), head(rawKey)]);
            if (hasThumb && hasPreview && hasRaw) {
              skipped++;
              if (skipped % 20 === 0) send(`Skipped ${skipped} already cached`);
              continue;
            }
          }

          try {
            const obj = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
            if (!obj.Body) { errors++; continue; }

            const fileBuffer = Buffer.from(toArrayBuffer(await obj.Body.transformToByteArray()));

            const embedded = extractRawThumbnail(fileBuffer);
            if (!embedded) {
              send(`WARN No embedded JPEG: ${key}`);
              errors++;
              continue;
            }

            const [thumb, preview] = await Promise.all([toWebpThumb(embedded), toWebpPreview(embedded)]);

            const saves = [
              thumb && r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: thumbKey,   Body: thumb,    ContentType: 'image/webp', Metadata: { 'source-key': key } })),
              preview && r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: previewKey, Body: preview, ContentType: 'image/webp', Metadata: { 'source-key': key } })),
              r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: rawKey, Body: embedded, ContentType: 'image/jpeg', Metadata: { 'source-key': key } })),
            ].filter(Boolean) as Promise<unknown>[];
            await Promise.all(saves);

            done++;
            send(`OK ${done}/${allKeys.length - skipped} — ${key.split('/').pop()} thumb=${Math.round((thumb?.length ?? 0) / 1024)}KB preview=${Math.round((preview?.length ?? 0) / 1024)}KB`);

          } catch (err) {
            send(`ERROR: ${key} — ${err instanceof Error ? err.message : String(err)}`);
            errors++;
          }

          // Small pause to avoid R2 rate limits
          await new Promise((r) => setTimeout(r, 50));
        }

        send(`\nDONE: ${done} generated, ${skipped} skipped, ${errors} errors`);
      } catch (err) {
        controller.enqueue(enc.encode(`FATAL: ${err instanceof Error ? err.message : String(err)}\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

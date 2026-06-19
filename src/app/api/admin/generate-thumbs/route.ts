import { NextRequest } from 'next/server';
import { ListObjectsV2Command, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { r2, BUCKET } from '@/lib/r2';
import { getCurrentUser } from '@/lib/auth';
import { extractRawThumbnail } from '@/lib/raw-thumb';

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

  // Optional: scope to one user prefix via ?userId=
  const userId = req.nextUrl.searchParams.get('userId') ?? user?.id ?? '';

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (msg: string) => controller.enqueue(enc.encode(msg + '\n'));

      try {
        send(`Listing RAW files for userId: ${userId} ...`);

        // ── List all RAW files in R2 ─────────────────────────────────────────
        const allKeys: string[] = [];
        let token: string | undefined;
        do {
          const list = await r2.send(new ListObjectsV2Command({
            Bucket: BUCKET,
            Prefix: `${userId}/`,
            ContinuationToken: token,
          }));
          for (const obj of list.Contents ?? []) {
            if (obj.Key && RAW_EXT.test(obj.Key)) {
              allKeys.push(obj.Key);
            }
          }
          token = list.NextContinuationToken;
        } while (token);

        send(`Found ${allKeys.length} RAW files. Starting thumbnail generation...`);

        let done = 0, skipped = 0, errors = 0;

        for (const key of allKeys) {
          const cacheKey = `_thumbs/${key}.jpg`;

          // Skip if already cached
          try {
            await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: cacheKey }));
            skipped++;
            if (skipped % 20 === 0) send(`Skipped ${skipped} already cached`);
            continue;
          } catch { /* not cached — generate */ }

          try {
            const obj = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
            if (!obj.Body) { errors++; continue; }

            const fileBuffer = Buffer.from(toArrayBuffer(await obj.Body.transformToByteArray()));

            const thumb = extractRawThumbnail(fileBuffer);
            if (!thumb) {
              send(`WARN No embedded JPEG: ${key}`);
              errors++;
              continue;
            }

            await r2.send(new PutObjectCommand({
              Bucket: BUCKET,
              Key: cacheKey,
              Body: thumb,
              ContentType: 'image/jpeg',
              Metadata: { 'source-key': key },
            }));

            done++;
            send(`OK ${done}/${allKeys.length - skipped} — ${key.split('/').pop()} (${Math.round(thumb.length / 1024)}KB)`);

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

export const dynamic = 'force-dynamic';

export async function GET() {
  const results: Record<string, string> = {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
  };

  // Test 1: sharp
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sharp = require('sharp');
    await sharp(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))
      .metadata()
      .catch(() => null);
    results.sharp = 'ok';
  } catch (err) {
    results.sharp = `ERROR: ${String(err)}`;
  }

  // Test 2: manual JPEG carving (no deps)
  try {
    const { extractRawThumbnail } = await import('@/lib/raw-thumb');
    const fakeRaw = Buffer.alloc(200_000, 0);
    // embed a minimal JPEG
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(60_000).fill(0xab), 0xff, 0xd9]);
    jpeg.copy(fakeRaw, 10_000);
    const result = await extractRawThumbnail(fakeRaw);
    results.jpegCarving = result ? `ok (${result.length} bytes)` : 'null';
  } catch (err) {
    results.jpegCarving = `ERROR: ${String(err)}`;
  }

  return Response.json(results);
}

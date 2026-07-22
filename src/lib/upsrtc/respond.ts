import { NextResponse } from 'next/server';
import { gzipSync } from 'node:zlib';

/** Below this, compression costs more CPU than it saves on the wire. */
const MIN_COMPRESS_BYTES = 32_768;

/**
 * JSON response with opportunistic gzip.
 *
 * Next.js `compress: true` does not apply to Route Handlers, and the live
 * fleet payload is ~3.8 MB (9.5k vehicles) on a 15-second poll. Gzip takes
 * that to a few hundred KB, which is the difference between a smooth
 * presentation and a stuttering one on conference-room wifi.
 */
export function jsonResponse(body: unknown, init?: { status?: number; acceptEncoding?: string | null }) {
  const payload = JSON.stringify(body);
  const acceptsGzip = (init?.acceptEncoding ?? '').toLowerCase().includes('gzip');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };

  if (acceptsGzip && payload.length >= MIN_COMPRESS_BYTES) {
    const compressed = gzipSync(payload);
    return new NextResponse(new Uint8Array(compressed), {
      status: init?.status ?? 200,
      headers: {
        ...headers,
        'Content-Encoding': 'gzip',
        // Vary matters so a shared cache never hands gzip to a client that
        // did not ask for it.
        Vary: 'Accept-Encoding',
      },
    });
  }

  return new NextResponse(payload, { status: init?.status ?? 200, headers });
}

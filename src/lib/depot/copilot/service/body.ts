export type BodyResult =
  { readonly ok: true; readonly text: string } | { readonly ok: false; readonly status: 400 | 413 };

const INVALID: BodyResult = { ok: false, status: 400 };
const TOO_LARGE: BodyResult = { ok: false, status: 413 };

/** Reads chunks until the end or the cap; throws whatever the stream throws. */
async function readChunks(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maxBytes: number,
): Promise<readonly Uint8Array[] | null> {
  let chunks: readonly Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return chunks;
    total += value.byteLength;
    if (total > maxBytes) return null;
    chunks = [...chunks, value];
  }
}

function decode(chunks: readonly Uint8Array[]): BodyResult {
  const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  chunks.reduce((offset, chunk) => {
    bytes.set(chunk, offset);
    return offset + chunk.byteLength;
  }, 0);
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return INVALID;
  }
}

/**
 * Reads a request body with a hard byte cap and a time limit. A declared
 * length over the cap is refused before reading; an undeclared one is read
 * chunk by chunk and the stream is cancelled as soon as it passes the cap, so
 * an oversized body is never buffered whole. A stream that errors, a body
 * still arriving after `waitMs`, and bytes that are not UTF-8 are a 400; the
 * stream's own error never reaches the caller.
 */
export async function readCappedBody(
  request: Request,
  maxBytes: number,
  waitMs: number,
): Promise<BodyResult> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) return TOO_LARGE;
  if (request.body === null) return { ok: true, text: '' };

  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), Math.max(0, waitMs));
  });
  const reading = readChunks(reader, maxBytes);
  // A stream that errors after the time limit has already been answered.
  reading.catch(() => undefined);
  try {
    const chunks = await Promise.race([reading, late]);
    if (chunks === 'late' || chunks === null) {
      await reader.cancel().catch(() => undefined);
      return chunks === null ? TOO_LARGE : INVALID;
    }
    return decode(chunks);
  } catch {
    return INVALID;
  } finally {
    clearTimeout(timer);
  }
}

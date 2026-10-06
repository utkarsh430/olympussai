export type BodyResult =
  { readonly ok: true; readonly text: string } | { readonly ok: false; readonly status: 400 | 413 };

/**
 * Reads a request body with a hard byte cap. A declared length over the cap is
 * refused before reading; an undeclared one is read chunk by chunk and the
 * stream is cancelled as soon as it passes the cap, so an oversized body is
 * never buffered whole. Bytes that are not UTF-8 are a 400.
 */
export async function readCappedBody(request: Request, maxBytes: number): Promise<BodyResult> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, status: 413 };
  if (request.body === null) return { ok: true, text: '' };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, status: 413 };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, status: 400 };
  }
}

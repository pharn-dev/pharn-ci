/**
 * A response body as UTF-8 text, or null when it is longer than `maxBytes` (the stream is cancelled at once). An absent
 * body is the empty string. A read that fails rejects. Used by the Action for the app's and the registries' answers; it
 * makes no request itself.
 */
export async function readCapped(response: Response, maxBytes: number): Promise<string | null> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(bytes);
}

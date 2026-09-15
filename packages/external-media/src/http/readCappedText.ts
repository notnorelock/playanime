/** Read a metadata response without buffering an unbounded upstream body. */
export async function readCappedText(
  response: Response,
  maxBytes: number,
  tooLarge: () => Error,
): Promise<string> {
  const body: ReadableStream<Uint8Array> | null = response.body;
  if (body === null) return '';
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes) throw tooLarge();
      chunks.push(decoder.decode(chunk.value, { stream: true }));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  chunks.push(decoder.decode());
  return chunks.join('');
}

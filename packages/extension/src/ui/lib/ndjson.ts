import type { ChatEvent } from "../../../../../lib/shared/types";

// One ChatEvent per line; lines may split across chunks. Blank/garbage lines are skipped.
export async function readNdjson(body: ReadableStream<Uint8Array>, onEvent: (e: ChatEvent) => void): Promise<void> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const emit = (line: string) => {
    if (!line.trim()) return;
    try {
      const e = JSON.parse(line);
      if (typeof e?.t === "string") onEvent(e as ChatEvent);
    } catch {
      // not JSON: skip
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    lines.forEach(emit);
  }
  emit(buf + dec.decode());
}

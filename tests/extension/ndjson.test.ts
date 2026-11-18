import { describe, it, expect } from "vitest";
import { readNdjson } from "../../packages/extension/src/ui/lib/ndjson";
import type { ChatEvent } from "../../lib/shared/types";

function stream(chunks: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      chunks.forEach((s) => c.enqueue(enc.encode(s)));
      c.close();
    },
  });
}

async function read(chunks: string[]) {
  const events: ChatEvent[] = [];
  await readNdjson(stream(chunks), (e) => events.push(e));
  return events;
}

describe("readNdjson", () => {
  it("joins a line split over two chunks into one event", async () => {
    expect(await read(['{"t":"delta","te', 'xt":"Hi"}\n'])).toEqual([{ t: "delta", text: "Hi" }]);
  });

  it("yields three events from one chunk", async () => {
    const events = await read(['{"t":"delta","text":"a"}\n{"t":"delta","text":"b"}\n{"t":"error","message":"x"}\n']);
    expect(events.map((e) => e.t)).toEqual(["delta", "delta", "error"]);
  });

  it("ignores blank and garbage lines, keeps a last line without newline", async () => {
    const events = await read(['\n  \nnot json\n{"no":"t"}\n{"t":"delta","text":"z"}']);
    expect(events).toEqual([{ t: "delta", text: "z" }]);
  });

  it("decodes a multi-byte character split across chunks", async () => {
    const bytes = new TextEncoder().encode('{"t":"delta","text":"–"}\n');
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 22));
        c.enqueue(bytes.slice(22));
        c.close();
      },
    });
    const events: ChatEvent[] = [];
    await readNdjson(body, (e) => events.push(e));
    expect(events).toEqual([{ t: "delta", text: "–" }]);
  });
});

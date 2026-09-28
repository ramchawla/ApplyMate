import { describe, it, expect } from "vitest";
import { JobQueue } from "../../packages/bridge/src/jobs";

describe("JobQueue", () => {
  it("runs jobs one at a time in FIFO order", async () => {
    const log: string[] = [];
    const q = new JobQueue<string, string>(async (x) => {
      log.push(`start ${x}`);
      await new Promise((r) => setTimeout(r, 10));
      log.push(`end ${x}`);
      return x.toUpperCase();
    });
    const a = q.enqueue("a");
    const b = q.enqueue("b");
    expect(q.get(b)!.status).toBe("queued");
    await q.idle();
    expect(log).toEqual(["start a", "end a", "start b", "end b"]);
    expect(q.get(a)).toMatchObject({ status: "done", result: "A" });
  });

  it("records errors without stopping the queue", async () => {
    const q = new JobQueue<number, number>(async (n) => {
      if (n === 1) throw new Error("bad");
      return n;
    });
    const bad = q.enqueue(1);
    const good = q.enqueue(2);
    await q.idle();
    expect(q.get(bad)).toMatchObject({ status: "error", error: "bad" });
    expect(q.get(good)).toMatchObject({ status: "done", result: 2 });
  });

  it("returns undefined for unknown ids", () => {
    expect(new JobQueue(async () => 1).get("nope")).toBeUndefined();
  });
});

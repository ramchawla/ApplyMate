#!/usr/bin/env node
// Test double for the claude CLI: echoes args/stdin/env back as structured output.
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const mode = process.env.FAKE_CLAUDE_MODE ?? "ok";
  if (mode === "hang") {
    setTimeout(() => {}, 60_000);
    return;
  }
  if (mode === "error") {
    process.stdout.write(JSON.stringify({ is_error: true, result: "boom" }));
    return;
  }
  if (mode.startsWith("stream")) {
    const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
    const delta = (text) =>
      out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } });
    out({ type: "system", subtype: "init" });
    if (mode === "stream-fail") {
      process.stderr.write("kaput");
      process.exit(1);
    }
    if (mode === "stream-error") {
      out({ type: "result", is_error: true, result: "usage limit", subtype: "success" });
      return;
    }
    delta("Hel");
    delta("lo");
    if (process.env.FAKE_CLAUDE_ECHO === "1")
      delta(JSON.stringify({ args: process.argv.slice(2), noClaudeMd: process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS }));
    if (mode !== "stream-noresult") out({ type: "result", is_error: false, subtype: "success" });
    return;
  }
  if (mode === "garbage") {
    process.stdout.write("not json");
    process.exit(1);
  }
  process.stdout.write(
    JSON.stringify({
      is_error: false,
      structured_output: {
        args: process.argv.slice(2),
        input,
        noClaudeMd: process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS,
      },
    }),
  );
});

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

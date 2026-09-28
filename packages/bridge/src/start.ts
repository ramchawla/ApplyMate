import { randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createServer } from "./server";
import { makeAnswerJob, makeTailorJob } from "./tailor-job";
import { openDb, migrate } from "../../../lib/local/db";

const PORT = Number(process.env.APPLYMATE_BRIDGE_PORT ?? 4179);
const dir = process.env.APPLYMATE_DIR ?? join(homedir(), ".applymate");
mkdirSync(dir, { recursive: true });

// Reuse the token across restarts so the extension stays paired.
const tokenPath = join(dir, "bridge-token");
function loadToken(): string {
  if (process.env.APPLYMATE_BRIDGE_TOKEN) return process.env.APPLYMATE_BRIDGE_TOKEN;
  try {
    const existing = readFileSync(tokenPath, "utf8").trim();
    if (existing) return existing;
  } catch {
    /* first run */
  }
  const fresh = randomBytes(24).toString("hex");
  writeFileSync(tokenPath, fresh, { mode: 0o600 });
  return fresh;
}
const token = loadToken();

const db = openDb();
migrate(db);
const server = createServer({
  token,
  db,
  tailor: makeTailorJob({ dir, db }),
  answer: makeAnswerJob({ dir }),
  profilePath: join(dir, "profile.yaml"),
  pairFile: join(dir, "paired-extension"),
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[ApplyMate] bridge listening on http://127.0.0.1:${PORT}`);
  console.log(`[ApplyMate] token in ${tokenPath} (the extension pairs automatically)`);
});

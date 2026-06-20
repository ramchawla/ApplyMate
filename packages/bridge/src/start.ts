import { randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createServer } from "./server";
import { OutputStore } from "./store";

const PORT = Number(process.env.APPLYMATE_BRIDGE_PORT ?? 4179);

// Generate a per-run bearer token and persist it with 0600 perms so the skill
// (and the user, pasting it into the extension once) can authenticate. Other
// local users/processes cannot read the token or call the protected API.
const token = process.env.APPLYMATE_BRIDGE_TOKEN ?? randomBytes(24).toString("hex");
const dir = join(homedir(), ".applymate");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "bridge-token"), token, { mode: 0o600 });

const store = new OutputStore();
const server = createServer(store, { token });

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[ApplyMate] bridge listening on http://127.0.0.1:${PORT}`);
  console.log(`[ApplyMate] bridge token: ${token}`);
  console.log("[ApplyMate] token saved to ~/.applymate/bridge-token");
});

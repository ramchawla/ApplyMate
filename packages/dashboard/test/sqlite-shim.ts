// Test-only shim: load node:sqlite via createRequire so vite/vitest does not
// try to bundle the (very new) builtin. Production code imports node:sqlite
// directly. Aliased in vitest.config.ts.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sqlite = require("node:sqlite") as typeof import("node:sqlite");

export const DatabaseSync = sqlite.DatabaseSync;

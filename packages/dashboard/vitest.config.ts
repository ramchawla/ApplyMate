import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// node:sqlite is newer than vite's builtin-module list, so vite tries to bundle
// it and fails. For tests, alias it to a createRequire shim that loads the real
// builtin at runtime. Production (Next.js, bridge) imports node:sqlite directly.
const sqliteShim = fileURLToPath(new URL("./test/sqlite-shim.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "node:sqlite": sqliteShim,
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["../../tests/dashboard/**/*.test.ts"],
  },
});

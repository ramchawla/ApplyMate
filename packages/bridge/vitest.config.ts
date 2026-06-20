import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// node:sqlite is newer than vite's builtin-module list; alias it to a
// createRequire shim for tests. Production imports node:sqlite directly.
const sqliteShim = fileURLToPath(
  new URL("../dashboard/test/sqlite-shim.ts", import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: {
      "node:sqlite": sqliteShim,
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["../../tests/bridge/**/*.test.ts"],
  },
});

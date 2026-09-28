import { defineConfig } from "vite";
import path from "path";

// Content scripts are classic scripts: one self-contained IIFE, no imports.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, "src/content/content.ts"),
      formats: ["iife"],
      name: "ApplyMateContent",
      fileName: () => "content.js",
    },
  },
});

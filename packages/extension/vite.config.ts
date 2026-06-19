/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        content: path.resolve(__dirname, 'src/content/content.ts'),
        background: path.resolve(__dirname, 'src/background.ts'),
        'side-panel': path.resolve(__dirname, 'side-panel.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name]-chunk.js',
        assetFileNames: '[name][extname]',
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['../../tests/extension/**/*.test.ts'],
  },
});

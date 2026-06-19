/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        content: path.resolve(__dirname, 'src/content/content.ts'),
        background: path.resolve(__dirname, 'src/background.ts'),
        'side-panel': path.resolve(__dirname, 'src/ui/side-panel.tsx'),
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

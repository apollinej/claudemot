import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Separate IIFE build for the content script.
 * Chrome MV3 content scripts can't use ES module imports.
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/content/content-script.ts'),
      output: {
        entryFileNames: 'content/content-script.js',
        format: 'iife',
      },
    },
    target: 'esnext',
    minify: false,
    sourcemap: true,
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
});

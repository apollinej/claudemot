import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Separate IIFE build for the service worker.
 * While MV3 supports type:"module" for service workers, some Chrome versions
 * have issues with relative imports. Building as IIFE avoids all module issues.
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/background/service-worker.ts'),
      output: {
        entryFileNames: 'background/service-worker.js',
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

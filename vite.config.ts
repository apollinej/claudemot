import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync } from 'fs';

function copyExtensionFiles() {
  return {
    name: 'copy-extension-files',
    closeBundle() {
      const dist = resolve(__dirname, 'dist');

      copyFileSync(resolve(__dirname, 'manifest.json'), resolve(dist, 'manifest.json'));

      for (const dir of ['popup', 'options']) {
        const outDir = resolve(dist, dir);
        if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
        copyFileSync(
          resolve(__dirname, `src/${dir}/${dir}.html`),
          resolve(outDir, `${dir}.html`)
        );
      }

      const iconsOut = resolve(dist, 'icons');
      if (!existsSync(iconsOut)) mkdirSync(iconsOut, { recursive: true });
      for (const size of ['16', '48', '128']) {
        copyFileSync(
          resolve(__dirname, `public/icons/icon${size}.png`),
          resolve(iconsOut, `icon${size}.png`)
        );
      }

      const assetsOut = resolve(dist, 'assets');
      if (!existsSync(assetsOut)) mkdirSync(assetsOut, { recursive: true });
      copyFileSync(
        resolve(__dirname, 'src/styles/content.css'),
        resolve(assetsOut, 'content.css')
      );
    },
  };
}

/**
 * Main build — popup and options as ES modules (loaded via HTML script tags).
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        'popup/popup': resolve(__dirname, 'src/popup/popup.ts'),
        'options/options': resolve(__dirname, 'src/options/options.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'shared/[name].js',
        format: 'es',
      },
    },
    target: 'esnext',
    minify: false,
    sourcemap: true,
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  plugins: [copyExtensionFiles()],
});

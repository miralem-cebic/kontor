import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileProtocol } from './build/fileProtocol.ts';

// The production build must run by double-clicking (file://) in Chrome/Edge:
// a single classic IIFE script, relative paths, no code splitting.
export default defineConfig({
  base: './',
  plugins: [react(), fileProtocol()],
  // the sRGB profile of the PDFs (src/pdf/assets.ts), imported with ?inline
  assetsInclude: ['**/*.icc'],
  build: {
    target: 'chrome120',
    modulePreload: false,
    // one script with the PDF library and its fonts (about 2.3 MB); the app is opened from disk, not downloaded (ADR 0005)
    chunkSizeWarningLimit: 4096,
    cssCodeSplit: false,
    // embed fonts as data: URLs so that no font request is needed under file://
    assetsInlineLimit: (filePath) => (filePath.endsWith('.woff2') ? true : undefined),
    rollupOptions: {
      output: {
        format: 'iife',
        entryFileNames: 'assets/app.js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});

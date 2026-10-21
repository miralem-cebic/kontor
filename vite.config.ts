import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileProtocol } from './build/fileProtocol.ts';

// The production build must run by double-clicking (file://) in Chrome/Edge:
// a single classic IIFE script, relative paths, no code splitting.
export default defineConfig({
  base: './',
  plugins: [react(), fileProtocol()],
  build: {
    target: 'chrome120',
    modulePreload: false,
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

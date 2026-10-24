import { defineConfig } from 'vitest/config';

export default defineConfig({
  // like vite.config.ts: the sRGB profile of the PDFs is imported with ?inline
  assetsInclude: ['**/*.icc'],
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});

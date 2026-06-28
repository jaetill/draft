import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.{test,spec}.{js,mjs}'],
    exclude: ['node_modules/**'],
  },
});

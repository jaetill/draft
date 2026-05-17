import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['tests/**/*.{test,spec}.{js,mjs}', 'src/**/*.{test,spec}.{js,mjs}'],
    exclude: ['node_modules/**', '.claude/worktrees/**', 'tests/e2e/**', 'spike/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json', 'lcov'],
      include: ['src/**/*.js'],
      exclude: ['src/**/*.test.js', 'spike/**', 'public/**'],
    },
  },
});

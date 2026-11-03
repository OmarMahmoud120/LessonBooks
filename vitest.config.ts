import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['backend/tests/**/*.test.ts', 'site/tests/**/*.test.ts', 'mobile/tests/**/*.test.ts'],
    exclude: ['**/*.rules.test.ts'],
    environment: 'node',
  },
});

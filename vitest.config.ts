/// <reference types="vitest" />
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    globals: false, // We import describe/it/expect from 'vitest' explicitly
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/*.test.ts'],
  },
});

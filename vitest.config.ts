import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  // Needed for component tests (.test.tsx). Without it Vitest hands raw JSX
  // to the parser and the file fails to load at all — which is why there
  // were no component tests in this repo despite testing-library being
  // installed. Server-side tests are unaffected.
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { include: ['@lessonbooks/contracts'] },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: {
    commonjsOptions: { include: [/node_modules/, /generated\/validators\.cjs/] },
    sourcemap: false,
  },
});

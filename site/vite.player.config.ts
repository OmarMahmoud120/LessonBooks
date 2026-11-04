import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    commonjsOptions: { include: [/node_modules/, /generated\/validators\.cjs/] },
    outDir: 'dist/player',
    emptyOutDir: true,
    lib: {
      entry: 'src/player/entry.tsx',
      name: 'LessonBooksPlayer',
      formats: ['iife'],
      fileName: () => 'player.js',
      cssFileName: 'player',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
    sourcemap: false,
  },
});

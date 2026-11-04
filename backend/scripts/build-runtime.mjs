import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
await mkdir('backend/dist/runtime', { recursive: true });
await build({
  entryPoints: ['backend/src/server.ts'],
  outfile: 'backend/dist/runtime/server.mjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  packages: 'external',
  plugins: [
    {
      name: 'inline-contracts',
      setup(builder) {
        builder.onResolve({ filter: /^@lessonbooks\/contracts(?:\/server)?$/ }, ({ path }) => ({
          path: resolve('doc/contracts', path.endsWith('/server') ? 'server.ts' : 'index.ts'),
        }));
      },
    },
  ],
});
await cp('backend/src/pdf-worker.mjs', 'backend/dist/runtime/pdf-worker.mjs');

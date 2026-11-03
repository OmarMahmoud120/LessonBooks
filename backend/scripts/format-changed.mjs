import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { root } from './agent-hook.mjs';
import { inspectPath } from './agent-policy.mjs';

const files = process.argv.slice(2).map((p) => resolve(root, p));
if (!files.length) process.exit(0);
for (const file of files) {
  if (inspectPath(file, root, true).decision !== 'allow')
    throw new Error('Refusing protected formatter target');
}
const prettier = resolve(root, 'node_modules/prettier/bin/prettier.cjs');
const eslint = resolve(root, 'node_modules/eslint/bin/eslint.js');
if (!existsSync(prettier) || !existsSync(eslint)) {
  console.error('Install approved development dependencies before changed-file checks.');
  process.exit(1);
}
let result = spawnSync(
  process.execPath,
  [prettier, '--write', '--ignore-unknown', '--', ...files],
  { cwd: root, stdio: 'inherit' },
);
if (result.status !== 0) process.exit(result.status ?? 1);
const code = files.filter((p) => /\.[cm]?[jt]sx?$/.test(p));
if (code.length) {
  result = spawnSync(process.execPath, [eslint, '--fix', '--', ...code], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

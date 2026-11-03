import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { root } from './agent-hook.mjs';

const [command, ...args] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(resolve(root, '.agents/manifest.json'), 'utf8'));
if (!manifest.commands.includes(command)) throw new Error('Unknown workflow');
if (command === 'check' || command === 'eval-prompts') {
  const result = spawnSync('npm', ['run', command === 'check' ? 'check' : 'eval:prompts'], {
    cwd: root,
    stdio: 'inherit',
  });
  process.exit(result.status ?? 1);
}
if (command === 'new-adr' && !args.includes('--preview')) {
  const title = args.join(' ').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9 -]{2,100}$/.test(title))
    throw new Error('Provide a plain-text ADR title (3–101 characters).');
  const dir = resolve(root, 'doc/decisions');
  const ids = readdirSync(dir).map((name) => Number(name.match(/^(\d+)-/)?.[1] ?? 0));
  const id = String(Math.max(0, ...ids) + 1).padStart(4, '0');
  const file = resolve(dir, `${id}-${title.toLowerCase().replaceAll(/ +/g, '-')}.md`);
  writeFileSync(
    file,
    `# ${id}: ${title}\n\nStatus: proposed\n\n## Context\n\n## Decision\n\n## Consequences\n\n## Verification\n`,
    { flag: 'wx' },
  );
  console.log(file);
} else if (command === 'phase-status') {
  console.log(readFileSync(resolve(root, 'doc/milestones.md'), 'utf8'));
  console.log(
    'Run npm run check for current evidence; checked boxes alone do not prove readiness.',
  );
} else {
  console.log(readFileSync(resolve(root, `.agents/commands/${command}.md`), 'utf8'));
  if (command === 'review')
    console.log(
      'This prints the review workflow. The host agent must launch the named reviewers; printing is not a completed review.',
    );
}

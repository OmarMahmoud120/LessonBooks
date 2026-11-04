import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const encoded = (await readFile('doc/fixtures/books/counting.pdf')).toString('base64');
const program = `
import assert from 'node:assert/strict';
import { execFile as callbackExec } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
const exec = promisify(callbackExec);
assert.notEqual(process.getuid(), 0);
assert.equal((await fetch('http://127.0.0.1:3001/v1/family')).status, 404);
const dir = await mkdtemp('/tmp/lessonbooks-tools-');
try {
  const pdf = dir + '/owned.pdf';
  await writeFile(pdf, Buffer.from(${JSON.stringify(encoded)}, 'base64'));
  await exec('clamscan', ['--no-summary', '--', pdf], { timeout: 60000 });
  await exec('pdftoppm', ['-singlefile', '-scale-to', '1800', '-png', pdf, dir + '/page'], { timeout: 60000 });
  const { stdout } = await exec('tesseract', [dir + '/page.png', 'stdout', '-l', 'eng', '--psm', '3'], { timeout: 60000 });
  assert.match(stdout, /one/i);
  console.log('Native tools passed: non-root worker, no family HTTP API, clean-PDF scan, rasterization and English OCR.');
} finally { await rm(dir, { recursive: true, force: true }); }
`;
const child = spawn(
  'docker',
  ['compose', '--env-file', '/dev/null', 'exec', '-T', 'worker', 'node', '--input-type=module'],
  { stdio: ['pipe', 'inherit', 'inherit'] },
);
child.stdin.end(program);
child.on('error', () => {
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});

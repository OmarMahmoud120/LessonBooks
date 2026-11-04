import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const encoded = (await readFile('doc/fixtures/books/counting.pdf')).toString('base64');
const arabicEncoded = (await readFile('doc/fixtures/books/arabic-counting-scanned.pdf')).toString(
  'base64',
);
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
  const arabic = dir + '/arabic.pdf';
  await writeFile(arabic, Buffer.from(${JSON.stringify(arabicEncoded)}, 'base64'));
  await exec('pdftoppm', ['-singlefile', '-scale-to', '2400', '-png', arabic, dir + '/arabic'], { timeout: 60000 });
  const { stdout: raw } = await exec('tesseract', [dir + '/arabic.png', 'stdout', '-l', 'ara+eng', '--oem', '1', '--psm', '3'], { timeout: 120000 });
  const arabicText = raw.normalize('NFKC').replace(/\\u0640/g, '');
  assert.doesNotMatch(arabicText, /[\\uFB50-\\uFEFF\\u0640]/);
  assert.match(arabicText, /تفاحتين|ثلاثة|تساوي/);
  console.log('Native tools passed: non-root worker, no family HTTP API, clean-PDF scan, rasterization, English and pinned-best Arabic OCR.');
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

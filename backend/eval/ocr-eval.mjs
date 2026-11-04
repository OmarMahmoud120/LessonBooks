// Orchestrates the Arabic OCR quality evaluation: generates synthetic pages on the host,
// recognizes them inside the ephemeral worker container (same models as production),
// aggregates letter-level CER and prints the report. Local binaries only; no AI calls.
import { generateEvalPages } from './ocr-eval-generate.mjs';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('.cache/ocr-eval');
const dir = resolve(root, 'pages');
const fastDir = resolve(root, 'tessdata-fast');
const fastSource = resolve('.cache/ocr-eval-models/tessdata-fast');
await rm(root, { recursive: true, force: true });
await mkdir(dir, { recursive: true });
await mkdir(fastDir, { recursive: true });
await copyFile(resolve(fastSource, 'ara.traineddata'), resolve(fastDir, 'ara.traineddata'));
const count = await generateEvalPages(dir);
await copyFile(
  resolve('backend/eval/ocr-eval-recognize.mjs'),
  resolve(root, 'ocr-eval-recognize.mjs'),
);
console.log(`Generated ${count} evaluation pages.`);
const child = spawn(
  'docker',
  [
    'run',
    '--rm',
    `-v${root}:/eval`,
    'lessonbooks-worker',
    'node',
    '/eval/ocr-eval-recognize.mjs',
    '/eval',
  ],
  { stdio: ['ignore', 'pipe', 'inherit'] },
);
let output = '';
child.stdout.on('data', (chunk) => {
  output += String(chunk);
});
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  if (code !== 0) {
    console.error(`recognizer exited ${code}`);
    process.exitCode = code ?? 1;
    return;
  }
  const results = JSON.parse(output);
  const mean = (rows) => rows.reduce((sum, r) => sum + r.cer_letters, 0) / rows.length;
  const by = (key) => {
    const groups = {};
    for (const row of results) (groups[row[key]] ??= []).push(row);
    return Object.fromEntries(Object.entries(groups).map(([k, rows]) => [k, mean(rows)]));
  };
  const report = {
    runs: results.length,
    overall: mean(results),
    best_model: mean(results.filter((r) => r.model === 'best')),
    fast_model: mean(results.filter((r) => r.model === 'fast')),
    scale_1800: mean(results.filter((r) => r.scale === 1800)),
    scale_2400: mean(results.filter((r) => r.scale === 2400)),
    bare: mean(results.filter((r) => !r.vocalized)),
    vocalized: mean(results.filter((r) => r.vocalized)),
    mixed: mean(results.filter((r) => r.mixed)),
    by_font: by('font'),
    by_size: by('size'),
    worst: [...results]
      .sort((a, b) => b.cer_letters - a.cer_letters)
      .slice(0, 5)
      .map(({ id, model, scale, cer_letters, cer_diacritic }) => ({
        id,
        model,
        scale,
        cer_letters,
        cer_diacritic,
      })),
  };
  console.log(JSON.stringify(report, null, 2));
});

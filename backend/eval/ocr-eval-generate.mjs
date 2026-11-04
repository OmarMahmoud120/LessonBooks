// Generates synthetic Arabic evaluation pages (fonts × sizes × vocalization) as PDFs
// with headless Chrome, plus a manifest consumed by ocr-eval-recognize.mjs in the worker
// container. Owned synthetic content only; no family data.
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

export const SENTENCES_BARE = [
  'العدد واضح: واحد، اثنان، ثلاثة.',
  'تفاحة واحدة وتفاحة أخرى تساوي تفاحتين.',
  'اثنان زائد واحد يساوي ثلاثة.',
  'يمكنك أن تعد على أصابعك.',
];
export const SENTENCES_VOCALIZED = [
  'العَدَدُ وَاضِحٌ: وَاحِدٌ، اِثْنَانِ، ثَلَاثَةٌ.',
  'تُفَاحَةٌ وَاحِدَةٌ وَتُفَاحَةٌ أُخْرَى تَسَاوِي تُفَاحَتَيْنِ.',
  'اِثْنَانِ زَائِدٌ وَاحِدٌ يُسَاوِي ثَلَاثَةٌ.',
  'يُمْكِنُكَ أَنْ تُعِدَّ عَلَى أَصَابِعِكَ.',
];
export const MIXED_BARE = 'العدد واضح: واحد، اثنان، ثلاثة. Count one, two, three.';
export const MIXED_VOCALIZED =
  'العَدَدُ وَاضِحٌ: وَاحِدٌ، اِثْنَانِ، ثَلَاثَةٌ. Count one, two, three.';
const FONTS = ['Geeza Pro', 'Al Bayan', 'Waseem'];
const SIZES = [24, 36, 60];
const chrome =
  process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function render(title, body) {
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
@page { size: A4; margin: 2.5cm; }
body { margin: 0; }
</style></head><body>${body}</body></html>`;
}

export async function generateEvalPages(outDir) {
  await mkdir(outDir, { recursive: true });
  const manifest = [];
  const pages = [];
  for (const font of FONTS)
    for (const size of SIZES)
      for (const vocalized of [false, true]) {
        const id = `${font.replace(/\s+/g, '-').toLowerCase()}-${size}${vocalized ? '-voc' : ''}`;
        const sentences = vocalized ? SENTENCES_VOCALIZED : SENTENCES_BARE;
        const body = `<div style="font-family: '${font}'; font-size: ${size}px; line-height: 2.2; direction: rtl;">${sentences
          .map((s) => `<p>${s}</p>`)
          .join('')}</div>`;
        pages.push({ id, html: render(id, body), reference: sentences.join(' ') });
        manifest.push({ id, font, size, vocalized, mixed: false });
      }
  for (const vocalized of [false, true]) {
    const id = `mixed-${vocalized ? 'voc' : 'bare'}`;
    const reference = vocalized ? MIXED_VOCALIZED : MIXED_BARE;
    const body = `<div style="font-family: 'Geeza Pro'; font-size: 36px; line-height: 2.2; direction: rtl;">
<p>${vocalized ? MIXED_VOCALIZED.split(' Count')[0] : MIXED_BARE.split(' Count')[0]}</p>
<p lang="en" dir="ltr" style="font-family: 'Times New Roman';">Count one, two, three.</p>
</div>`;
    pages.push({ id, html: render(id, body), reference });
    manifest.push({ id, font: 'Geeza Pro', size: 36, vocalized, mixed: true });
  }
  const tmp = mkdtempSync(resolve(tmpdir(), 'ocr-eval-html-'));
  try {
    for (const page of pages) {
      const html = resolve(tmp, `${page.id}.html`);
      await writeFile(html, page.html);
      const pdf = resolve(outDir, `${page.id}.pdf`);
      const result = spawnSync(chrome, [
        '--headless=new',
        '--no-pdf-header-footer',
        `--print-to-pdf=${pdf}`,
        html,
      ]);
      if (result.status !== 0) throw new Error(`chrome_failed ${page.id}`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  await writeFile(
    resolve(outDir, 'manifest.json'),
    JSON.stringify(
      { pages: manifest, references: Object.fromEntries(pages.map((p) => [p.id, p.reference])) },
      null,
      2,
    ),
  );
  return manifest.length;
}

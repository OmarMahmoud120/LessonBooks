import { it, expect } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { PDFIngestor, normalizeText, detectPageLanguage } from '../src/ingest';
it('extracts an owned sample PDF in a bounded worker', async () => {
  const data = await readFile('doc/fixtures/books/counting.pdf');
  const extracted = await new PDFIngestor().extract(data);
  expect(extracted.pages[0]?.text).toContain('One and one make two');
  expect(extracted.language).toBe('en-GB');
  expect(extracted.pages[0]?.language).toBe('en');
});
it('extracts Arabic through OCR regardless of text layer, in logical order', async () => {
  const data = await readFile('doc/fixtures/books/arabic-counting.pdf');
  let rasterized = false;
  const extracted = await new PDFIngestor(false, async (command) => {
    if (command === 'pdftoppm') rasterized = true;
    return 'تفاحة واحدة وتفاحة أخرى تساوي تفاحتين';
  }).extract(data, 'ar');
  expect(rasterized).toBe(true);
  expect(extracted.language).toBe('ar');
  expect(extracted.pages[0]?.language).toBe('ar');
  expect(extracted.pages[0]?.text).toContain('تفاحتين');
  expect(extracted.pages[0]?.text).not.toMatch(/[\uFB50-\uFEFF]/);
});
it('rejects languages outside the supported profile set before parsing', async () => {
  const data = await readFile('doc/fixtures/books/counting.pdf');
  await expect(new PDFIngestor().extract(data, 'fr-FR')).rejects.toThrow(
    'unsupported_source_language',
  );
});
it('scales and routes OCR by language with the accurate LSTM engine mode', async () => {
  const data = await readFile('doc/fixtures/books/arabic-counting-scanned.pdf');
  const calls: [string, string[]][] = [];
  const extracted = await new PDFIngestor(false, async (command, args) => {
    calls.push([command, args]);
    return command === 'tesseract' ? 'تفاحة واحدة و تفاحة أخرى تساوي تفاحتين' : '';
  }).extract(data, 'ar');
  const raster = calls.find(([command]) => command === 'pdftoppm')![1];
  expect(raster).toContain('2400');
  const ocr = calls.find(([command]) => command === 'tesseract')![1];
  expect(ocr.slice(ocr.indexOf('-l') + 1)).toEqual(['ara+eng', '--oem', '1', '--psm', '3']);
  expect(extracted.images).toHaveLength(0);
});
it('persists rasterized pages through the sink inside the family scope', async () => {
  const data = await readFile('doc/fixtures/books/arabic-counting-scanned.pdf');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const persisted: { path: string; bytes: Uint8Array }[] = [];
  const extracted = await new PDFIngestor(false, async (command, args) => {
    if (command === 'pdftoppm') await writeFile(`${args.at(-1)}.png`, png);
    return 'نص عربي تجريبي';
  }).extract(data, 'ar', async (page, bytes) => {
    const path = `families/alice/kids/k/books/b/hash/pages/page-${page}.png`;
    persisted.push({ path, bytes });
    return path;
  });
  expect(persisted[0]?.bytes).toEqual(png);
  expect(extracted.images[0]?.asset_id).toBe(persisted[0]!.path);
  expect(extracted.pages[0]?.text).toBe('نص عربي تجريبي');
});
it('fails closed when a required virus scanner is unavailable', async () => {
  const data = await readFile('doc/fixtures/books/counting.pdf');
  await expect(
    new PDFIngestor(true, async () => {
      throw new Error('scanner unavailable');
    }).extract(data),
  ).rejects.toThrow();
});
it('normalizes Arabic presentation forms and strips tatweel', () => {
  expect(normalizeText('ﺍﻟﻌﺒﺎﺱ')).toBe('العباس');
  expect(normalizeText('مرحـبا')).toBe('مرحبا');
  expect(normalizeText('One ﬁne day')).toBe('One fine day');
});
it('detects page language by script dominance with a fallback', () => {
  expect(detectPageLanguage('مرحبا بكم في العد', 'en-GB')).toBe('ar');
  expect(detectPageLanguage('Count one two three', 'en-GB')).toBe('en');
  expect(detectPageLanguage('1234567890', 'ar')).toBe('ar');
});

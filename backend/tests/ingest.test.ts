import { it, expect } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { PDFIngestor, normalizeText, detectPageLanguage } from '../src/ingest';
import { CloudflareVisionOCR } from '../src/cloudflare-ocr';
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

it('routes a rasterized Arabic PDF through the injected vision adapter with usage and image refs', async () => {
  const png = await readFile('doc/fixtures/books/arabic-counting-vocalized.png');
  const calls: string[] = [];
  const ocr = new CloudflareVisionOCR('a'.repeat(32), 'synthetic-token', async () =>
    Response.json({
      choices: [{ finish_reason: 'stop', message: { content: 'تُفَاحَةٌ وَاحِدَةٌ' } }],
      usage: { prompt_tokens: 366, completion_tokens: 636 },
    }),
  );
  const ingestor = new PDFIngestor(
    true,
    async (command, args) => {
      calls.push(command);
      if (command === 'pdftoppm') await writeFile(`${args.at(-1)}.png`, png);
      return '';
    },
    ocr,
  );
  const sinks: Uint8Array[] = [];
  const result = await ingestor.extract(
    await readFile('doc/fixtures/books/arabic-counting.pdf'),
    'ar',
    async (_page, bytes) => {
      sinks.push(bytes);
      return 'synthetic/page-1.png';
    },
  );
  expect(calls).toEqual(['clamscan', 'pdftoppm']);
  expect(result.pages).toEqual([{ page: 1, text: 'تُفَاحَةٌ وَاحِدَةٌ', language: 'ar' }]);
  expect(result.images).toEqual([{ page: 1, asset_id: 'synthetic/page-1.png' }]);
  expect(sinks).toEqual([png]);
  expect(result.ocr?.[0]).toMatchObject({
    page: 1,
    provider: 'cloudflare',
    prompt_version: 'ocr.ar.v1',
    prompt_tokens: 366,
  });
  expect(result.ocr?.[0]).not.toHaveProperty('text');
});

it('rejects books exceeding the hosted page allowance before rasterization or transport', async () => {
  // Minimal owned two-page PDF, with valid offsets; no parser or native-process mocks.
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, i) => {
    const offset = Buffer.byteLength(pdf);
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 5\n0000000000 65535 f \n${offsets.map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  let nativeCalls = 0;
  let requests = 0;
  const ingestor = new PDFIngestor(
    false,
    async () => {
      nativeCalls++;
      return '';
    },
    new CloudflareVisionOCR('a'.repeat(32), 'synthetic-token', async () => {
      requests++;
      return new Response();
    }),
  );
  await expect(ingestor.extract(Buffer.from(pdf), 'ar')).rejects.toThrow('ocr_page_limit');
  expect(nativeCalls).toBe(0);
  expect(requests).toBe(0);
});

it('fails hosted ingestion without persisting images or silently falling back to local OCR', async () => {
  const png = await readFile('doc/fixtures/books/arabic-counting-vocalized.png');
  const calls: string[] = [];
  let rasterPath = '';
  let sinks = 0;
  const ingestor = new PDFIngestor(
    false,
    async (command, args) => {
      calls.push(command);
      rasterPath = `${args.at(-1)}.png`;
      await writeFile(rasterPath, png);
      return '';
    },
    new CloudflareVisionOCR('a'.repeat(32), 'synthetic-token', async () =>
      Response.json({
        choices: [{ finish_reason: 'length', message: { content: 'نص جزئي' } }],
      }),
    ),
  );
  await expect(
    ingestor.extract(
      await readFile('doc/fixtures/books/arabic-counting-scanned.pdf'),
      'ar',
      async () => {
        sinks++;
        return '';
      },
    ),
  ).rejects.toThrow('ocr_incomplete');
  expect(calls).toEqual(['pdftoppm']);
  expect(sinks).toBe(0);
  await expect(readFile(rasterPath)).rejects.toMatchObject({ code: 'ENOENT' });
});

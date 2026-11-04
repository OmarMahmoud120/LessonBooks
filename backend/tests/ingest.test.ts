import { it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFIngestor } from '../src/ingest';
it('extracts an owned sample PDF in a bounded worker', async () => {
  const data = await readFile('doc/fixtures/books/counting.pdf');
  const extracted = await new PDFIngestor().extract(data);
  expect(extracted.pages[0]?.text).toContain('One and one make two');
  expect(extracted.language).toBe('en-GB');
});
it('fails closed when a required virus scanner is unavailable', async () => {
  const data = await readFile('doc/fixtures/books/counting.pdf');
  await expect(
    new PDFIngestor(true, async () => {
      throw new Error('scanner unavailable');
    }).extract(data),
  ).rejects.toThrow();
});

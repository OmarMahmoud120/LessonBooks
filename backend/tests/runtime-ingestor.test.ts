import { expect, it, vi } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { runtimeConfig } from '../src/runtime-config';
import { createRuntimeIngestor } from '../src/runtime-ingestor';
import type { OCRTransport } from '../src/cloudflare-ocr';

const approved = {
  OCR_PROVIDER: 'cloudflare',
  CLOUDFLARE_OCR_APPROVED: 'true',
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  CLOUDFLARE_API_KEY: 'synthetic-token',
};
async function setup(overrides: Record<string, string> = {}) {
  const env = { ...approved, ...overrides };
  const png = await readFile('doc/fixtures/books/arabic-counting-vocalized.png');
  const send = vi.fn<OCRTransport>(async () =>
    Response.json({
      choices: [{ finish_reason: 'stop', message: { content: 'تُفَاحَةٌ وَاحِدَةٌ' } }],
      usage: { prompt_tokens: 366, completion_tokens: 636 },
    }),
  );
  const run = vi.fn(async (command: string, args: string[]) => {
    if (command === 'pdftoppm') await writeFile(`${args.at(-1)}.png`, png);
    return 'local transcription';
  });
  const ingestor = createRuntimeIngestor(runtimeConfig(env), env, { send, run });
  return {
    ingestor,
    send,
    run,
    pdf: await readFile('doc/fixtures/books/arabic-counting-scanned.pdf'),
  };
}
it('defaults to local OCR without consulting Cloudflare secrets', async () => {
  const env = new Proxy(
    {},
    {
      get() {
        throw new Error('unexpected credential access');
      },
    },
  );
  const run = vi.fn(async () => 'نص محلي');
  const ingestor = createRuntimeIngestor(runtimeConfig({}), env, { run });
  const result = await ingestor.extract(
    await readFile('doc/fixtures/books/arabic-counting-scanned.pdf'),
    'ar',
  );
  expect(result.pages[0]?.text).toBe('نص محلي');
  expect(run.mock.calls).toHaveLength(2);
});
it('routes separate owned books through fresh clients within the shared worker cap', async () => {
  const { ingestor, send, run, pdf } = await setup({ CLOUDFLARE_OCR_MAX_REQUESTS: '2' });
  const claim = vi.fn(async () => undefined);
  for (let i = 0; i < 2; i++) {
    const result = await ingestor.extract(pdf, 'ar', undefined, claim);
    expect(result.ocr?.[0]?.provider).toBe('cloudflare');
  }
  await expect(ingestor.extract(pdf, 'ar', undefined, claim)).rejects.toThrow('ocr_request_limit');
  expect(send).toHaveBeenCalledTimes(2);
  expect(claim).toHaveBeenCalledTimes(2);
  expect(run.mock.calls.every(([command]) => command === 'pdftoppm')).toBe(true);
});
it('rejects unowned sources and missing job authorization before transport', async () => {
  const { ingestor, send, run, pdf } = await setup();
  await expect(ingestor.extract(Buffer.from('%PDF-1.7 private upload'), 'ar')).rejects.toThrow(
    'ocr_synthetic_source_required',
  );
  expect(run).not.toHaveBeenCalled();
  await expect(ingestor.extract(pdf, 'ar')).rejects.toThrow('ocr_job_context_required');
  expect(send).not.toHaveBeenCalled();
});
it('keeps a single shared request allowance under concurrent book ingestion', async () => {
  const { ingestor, send, pdf } = await setup();
  const claim = async () => {
    await Promise.resolve();
  };
  const results = await Promise.allSettled([
    ingestor.extract(pdf, 'ar', undefined, claim),
    ingestor.extract(pdf, 'ar', undefined, claim),
  ]);
  expect(send).toHaveBeenCalledTimes(1);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
});
it('honors cancellation or duplicate-job refusal before any provider send', async () => {
  const { ingestor, send, pdf } = await setup();
  await expect(
    ingestor.extract(pdf, 'ar', undefined, async () => {
      throw new Error('cancelled');
    }),
  ).rejects.toThrow('cancelled');
  expect(send).not.toHaveBeenCalled();
});
it('keeps text-bearing English fixtures working without spending an OCR request', async () => {
  const { ingestor, send, run } = await setup();
  const result = await ingestor.extract(await readFile('doc/fixtures/books/counting.pdf'), 'en-GB');
  expect(result.pages[0]?.text).toContain('One and one make two');
  expect(send).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});
it('fails on missing credentials at worker startup and leaves API-only instances credential-free', () => {
  expect(() => createRuntimeIngestor(runtimeConfig(approved), {})).toThrow(
    'ocr_runtime_not_approved',
  );
  expect(() =>
    createRuntimeIngestor(runtimeConfig(approved), { CLOUDFLARE_OCR_APPROVED: 'true' }),
  ).toThrow('ocr_credentials_invalid');
  expect(() =>
    createRuntimeIngestor(runtimeConfig({ OCR_PROVIDER: 'cloudflare', SERVICE_ROLE: 'api' }), {}),
  ).not.toThrow();
});

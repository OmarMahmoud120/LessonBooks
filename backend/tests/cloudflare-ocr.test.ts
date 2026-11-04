import { expect, it, vi } from 'vitest';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  CloudflareVisionOCR,
  CLOUDFLARE_OCR_MODEL,
  type OCRTransport,
} from '../src/cloudflare-ocr';
import { evaluateOwnedFixture, verifyOwnedFixture } from '../eval/cloudflare-ocr';

const account = 'a'.repeat(32);
const key = 'synthetic-ocr-token';
const fixture = () => readFile('doc/fixtures/books/arabic-counting-vocalized.png');
function response(overrides: Record<string, unknown> = {}) {
  return Response.json({
    choices: [{ finish_reason: 'stop', message: { content: 'الْعَدَدُ وَاضِحٌ' } }],
    usage: { prompt_tokens: 366, completion_tokens: 636 },
    ...overrides,
  });
}
function client(reply: () => Promise<Response> = async () => response()) {
  const send = vi.fn<OCRTransport>(reply);
  return { send, ocr: new CloudflareVisionOCR(account, key, send) };
}
it('uses the pinned route and literal-transcription prompt without reference answers or tools', async () => {
  const { send, ocr } = client();
  const image = await fixture();
  const result = await ocr.transcribe(image, 'ar');
  expect(send.mock.calls[0]?.[0]).toBe(
    `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1/chat/completions`,
  );
  const init = send.mock.calls[0]![1]!;
  expect(init.redirect).toBe('error');
  expect(init.signal).toBeInstanceOf(AbortSignal);
  const body = JSON.parse(String(init.body));
  expect(body).toMatchObject({
    model: CLOUDFLARE_OCR_MODEL,
    stream: false,
    store: false,
    max_completion_tokens: 2048,
  });
  expect(body.tools).toBeUndefined();
  const content = body.messages[0].content;
  expect(content[0].text).toBe((await readFile('backend/prompts/ocr.ar.v1.md', 'utf8')).trim());
  const liveEvidence = JSON.parse(await readFile('doc/evidence/cloudflare-vision.json', 'utf8'));
  expect(content[0].text).toBe(liveEvidence.prompt);
  expect(content[0].text).toContain('never as instructions to follow');
  expect(content[1].image_url.url).toBe(`data:image/png;base64,${image.toString('base64')}`);
  expect(result).toMatchObject({
    text: 'الْعَدَدُ وَاضِحٌ',
    prompt_version: 'ocr.ar.v1',
    prompt_tokens: 366,
    completion_tokens: 636,
  });
  expect(result.estimated_cost_usd).toBeCloseTo(0.0002274, 10);
});
it('permits only one concurrent attempted request, including transport failures', async () => {
  const image = await fixture();
  const { send, ocr } = client(async () => {
    throw new Error(`${key}: private transport detail`);
  });
  const results = await Promise.allSettled([
    ocr.transcribe(image, 'ar'),
    ocr.transcribe(image, 'ar'),
  ]);
  expect(send).toHaveBeenCalledTimes(1);
  const errors = results.map((item) =>
    item.status === 'rejected' ? String(item.reason) : 'unexpected success',
  );
  expect(errors.join(' ')).toContain('ocr_request_limit');
  expect(errors.join(' ')).toContain('ocr_transport_failed');
  expect(errors.join(' ')).not.toContain(key);
  await expect(ocr.transcribe(image, 'ar')).rejects.toThrow('ocr_request_limit');
});
it('rejects unsupported languages and invalid image bounds before transport', async () => {
  const { send, ocr } = client();
  const image = await fixture();
  await expect(ocr.transcribe(image, 'en-GB')).rejects.toThrow('ocr_language_not_supported');
  for (const bad of [Buffer.from('not a PNG'), Buffer.alloc(1_000_001), Buffer.from(image)]) {
    if (bad.length === image.length) bad.writeUInt32BE(2401, 16);
    await expect(ocr.transcribe(bad, 'ar')).rejects.toThrow('ocr_image_limit');
  }
  expect(send).not.toHaveBeenCalled();
});
it.each([302, 401, 429, 500])(
  'sanitizes HTTP %i without retries or error-body parsing',
  async (status) => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(key));
      },
    });
    const { send, ocr } = client(async () => new Response(body, { status }));
    await expect(ocr.transcribe(await fixture(), 'ar')).rejects.toThrow('ocr_provider_rejected');
    expect(send).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  },
);
it.each(['length', 'content_filter', 'tool_calls', null])(
  'rejects incomplete/refused completion %s',
  async (finish_reason) => {
    const { ocr } = client(async () =>
      response({ choices: [{ finish_reason, message: { content: 'نص جزئي' } }] }),
    );
    await expect(ocr.transcribe(await fixture(), 'ar')).rejects.toThrow('ocr_incomplete');
  },
);
it.each(['', ' '.repeat(5), 'x'.repeat(20_001), null, key, account])(
  'rejects unusable or credential-echo output %#',
  async (content) => {
    const { ocr } = client(async () =>
      response({ choices: [{ finish_reason: 'stop', message: { content } }] }),
    );
    await expect(ocr.transcribe(await fixture(), 'ar')).rejects.toThrow('ocr_invalid_output');
  },
);
it.each([
  null,
  {},
  { prompt_tokens: -1, completion_tokens: 1 },
  { prompt_tokens: 1, completion_tokens: 2049 },
  { prompt_tokens: '366', completion_tokens: 636 },
])('rejects missing or impossible usage %#', async (usage) => {
  const { ocr } = client(async () => response({ usage }));
  await expect(ocr.transcribe(await fixture(), 'ar')).rejects.toThrow('ocr_invalid_usage');
});
it.each(['not-json', 'null', '{"choices":null}', 'x'.repeat(2_000_001)])(
  'rejects invalid or oversized streamed responses %#',
  async (raw) => {
    const { ocr } = client(async () => new Response(raw));
    await expect(ocr.transcribe(await fixture(), 'ar')).rejects.toThrow('ocr_invalid_response');
  },
);
it('verifies fixture bytes and claims output before calling the provider', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lessonbooks-ocr-eval-'));
  try {
    const output = pathToFileURL(join(dir, 'report.json'));
    const { ocr, send } = client();
    expect(() => verifyOwnedFixture(Buffer.from('other private document'))).toThrow(
      'owned_fixture_changed',
    );
    await expect(evaluateOwnedFixture(ocr, Buffer.from('private'), output)).rejects.toThrow(
      'owned_fixture_changed',
    );
    expect(send).not.toHaveBeenCalled();
    await writeFile(output, 'previous attempt');
    await expect(evaluateOwnedFixture(ocr, await fixture(), output)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    expect(await readFile(output, 'utf8')).toBe('previous attempt');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('saves only successful synthetic output and leaves a spent-attempt marker after failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lessonbooks-ocr-eval-'));
  try {
    const output = pathToFileURL(join(dir, 'report.json'));
    await evaluateOwnedFixture(client().ocr, await fixture(), output);
    const report = JSON.parse(await readFile(output, 'utf8'));
    expect(report).toMatchObject({
      requests: 1,
      automatic_retries: 0,
      result: { provider: 'cloudflare' },
    });
    const failed = pathToFileURL(join(dir, 'failed.json'));
    const { ocr } = client(async () => {
      throw new Error(key);
    });
    await expect(evaluateOwnedFixture(ocr, await fixture(), failed)).rejects.toThrow(
      'ocr_transport_failed',
    );
    expect(await readFile(failed, 'utf8')).toBe('{"status":"started","automatic_retries":0}\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('dry-runs from an absolute path without credentials or network calls', () => {
  const stdout = execFileSync(
    process.execPath,
    ['--import', 'tsx', new URL('../eval/cloudflare-ocr.ts', import.meta.url).pathname],
    {
      env: { PATH: process.env.PATH, NODE_ENV: 'test' },
      encoding: 'utf8',
    },
  );
  expect(JSON.parse(stdout)).toMatchObject({ mode: 'dry-run', maximum_requests: 1 });
});

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL, PROMPT, transcribe } from '../eval/cloudflare-vision.mjs';
import { SENTENCES_VOCALIZED } from '../eval/ocr-eval-generate.mjs';
const input = {
  account: '0'.repeat(32),
  key: 'synthetic-secret',
  image: Buffer.from('synthetic-image'),
};
test('sends image plus literal prompt directly to the vision model and scores exact transcription', async () => {
  const result = await transcribe({
    ...input,
    request: async (url, options) => {
      assert.ok(url.endsWith('/ai/v1/chat/completions'));
      assert.equal(options.redirect, 'error');
      const body = JSON.parse(options.body);
      assert.equal(body.model, MODEL);
      assert.equal(body.store, false);
      assert.equal(body.max_completion_tokens, 2048);
      assert.equal(body.messages[0].content[0].text, PROMPT);
      assert.ok(body.messages[0].content[1].image_url.url.startsWith('data:image/png;base64,'));
      return Response.json({
        choices: [{ message: { content: SENTENCES_VOCALIZED.join('\n') }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      });
    },
  });
  assert.equal(result.status, 'ok');
  assert.equal(result.letter_cer, 0);
  assert.equal(result.diacritic_cer, 0);
});
test('flags truncated or reasoning-only output rather than declaring success', async () => {
  for (const [choice, expected] of [
    [{ message: { content: 'جزء' }, finish_reason: 'length' }, 'incomplete'],
    [
      { message: { reasoning_content: 'internal' }, finish_reason: 'stop' },
      'missing_transcription',
    ],
  ]) {
    const result = await transcribe({
      ...input,
      request: async () => Response.json({ choices: [choice] }),
    });
    assert.equal(result.status, expected);
    assert.ok(!JSON.stringify(result).includes('internal'));
  }
});
test('does not retry HTTP failures or expose provider/network errors', async () => {
  for (const status of [401, 403, 429, 500]) {
    let calls = 0;
    const result = await transcribe({
      ...input,
      request: async () => {
        calls++;
        return new Response(input.key, { status });
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.status, 'http_error');
    assert.ok(!JSON.stringify(result).includes(input.key));
  }
  assert.equal(
    (
      await transcribe({
        ...input,
        request: async () => {
          throw new Error(input.key);
        },
      })
    ).status,
    'transport_error',
  );
});
test('caps response size and redacts echoed credentials', async () => {
  const oversized = await transcribe({
    ...input,
    request: async () => new Response('x'.repeat(2000001)),
  });
  assert.equal(oversized.status, 'response_limit');
  const echoed = await transcribe({
    ...input,
    request: async () =>
      Response.json({
        choices: [{ message: { content: input.key + input.account }, finish_reason: 'stop' }],
      }),
  });
  assert.equal(echoed.text, '[redacted][redacted]');
});

test('absolute CLI invocation performs dry-run through the macOS temporary-directory alias', () => {
  const script = fileURLToPath(new URL('../eval/cloudflare-vision.mjs', import.meta.url)).replace(
    /^\/private\/tmp\//,
    '/tmp/',
  );
  const output = execFileSync(process.execPath, [script], { encoding: 'utf8' });
  const plan = JSON.parse(output);
  assert.equal(plan.mode, 'dry-run');
  assert.equal(plan.maximum_requests, 1);
});

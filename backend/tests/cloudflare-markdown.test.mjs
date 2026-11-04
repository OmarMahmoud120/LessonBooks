import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  convert,
  characterErrorRate,
  scoringText,
  normalize,
  cases,
} from '../eval/cloudflare-markdown.mjs';
const input = {
  account: '0'.repeat(32),
  key: 'synthetic-token',
  file: 'owned.pdf',
  bytes: Buffer.from('%PDF-1.7 synthetic'),
  mime: 'application/pdf',
};
test('sends multipart bytes to the fixed Cloudflare endpoint and parses individual results', async () => {
  const result = await convert({
    ...input,
    request: async (url, options) => {
      assert.equal(
        url,
        `https://api.cloudflare.com/client/v4/accounts/${input.account}/ai/tomarkdown`,
      );
      assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
      assert.equal(options.redirect, 'error');
      assert.equal(options.body.get('files').name, 'owned.pdf');
      assert.deepEqual(JSON.parse(options.body.get('conversionOptions')), {
        pdf: { metadata: false },
      });
      return Response.json({
        success: true,
        result: [{ format: 'markdown', data: 'owned text', tokens: 2 }],
      });
    },
  });
  assert.equal(result.text, 'owned text');
  assert.equal(result.status, 'ok');
});
test('treats per-file errors inside a successful HTTP response as failure', async () => {
  const result = await convert({
    ...input,
    request: async () =>
      Response.json({
        success: true,
        result: [{ format: 'error', error: 'sensitive provider details' }],
      }),
  });
  assert.equal(result.status, 'conversion_error');
  assert.ok(!JSON.stringify(result).includes('sensitive'));
});
test('stops without retrying on authorization, throttling and provider failures', async () => {
  for (const status of [401, 403, 429, 500]) {
    let calls = 0;
    const result = await convert({
      ...input,
      request: async () => {
        calls++;
        return new Response('secret error body', { status });
      },
    });
    assert.equal(result.stop, true);
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(result).includes('secret'));
  }
});
test('does not expose credential-bearing network errors', async () => {
  const result = await convert({
    ...input,
    request: async () => {
      throw new Error(input.key);
    },
  });
  assert.equal(result.status, 'transport_error');
  assert.ok(!JSON.stringify(result).includes(input.key));
});
test('bounds malformed and oversized responses', async () => {
  for (const [response, expected] of [
    [new Response('not JSON'), 'invalid_response'],
    [new Response('x'.repeat(2_000_001)), 'response_limit'],
    [
      Response.json({ success: true, result: [{ format: 'markdown', data: 'x'.repeat(20001) }] }),
      'output_limit',
    ],
  ]) {
    const result = await convert({ ...input, request: async () => response });
    assert.equal(result.status, expected);
    assert.equal(result.stop, true);
  }
});
test('scores missing output and diacritics without confusing format changes with letter errors', () => {
  assert.equal(characterErrorRate('abc', ''), 1);
  assert.equal(characterErrorRate('abc', 'abc'), 0);
  assert.equal(normalize('عَـدَدٌ'), normalize('عدد'));
  assert.notEqual(normalize('عَـدَدٌ', true), normalize('عدد', true));
  assert.equal(cases.length, 4);
});

test('excludes known converter boilerplate from transcription scoring only', () => {
  const raw = '# owned.pdf\n## Contents\n### Page 1\nOne and one make two.\n';
  assert.equal(scoringText(raw, 'owned.pdf'), 'One and one make two.\n');
  assert.equal(scoringText(raw, 'different.pdf'), raw);
});

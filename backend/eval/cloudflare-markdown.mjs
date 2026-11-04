import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { SENTENCES_VOCALIZED } from './ocr-eval-generate.mjs';

export const cases = [
  {
    file: 'counting.pdf',
    mime: 'application/pdf',
    reference: 'Count one, two, three. One and one make two. Two and one make three.',
  },
  { file: 'arabic-counting.pdf', mime: 'application/pdf', reference: null },
  { file: 'arabic-counting-scanned.pdf', mime: 'application/pdf', reference: null },
  {
    file: 'arabic-counting-vocalized.png',
    mime: 'image/png',
    reference: SENTENCES_VOCALIZED.join(' '),
  },
];
export function normalize(text, diacritics = false) {
  let value = text.normalize('NFKC').replace(/\u0640/g, '');
  if (!diacritics) value = value.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '');
  return value.replace(diacritics ? /[^\p{L}\p{N}\u064B-\u065F\u0670]/gu : /[^\p{L}\p{N}]/gu, '');
}
export function characterErrorRate(reference, hypothesis) {
  const expected = Array.from(reference);
  const actual = Array.from(hypothesis);
  let previous = Array.from({ length: actual.length + 1 }, (_, i) => i);
  for (let i = 1; i <= expected.length; i++) {
    const next = [i];
    for (let j = 1; j <= actual.length; j++)
      next[j] = Math.min(
        next[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (expected[i - 1] === actual[j - 1] ? 0 : 1),
      );
    previous = next;
  }
  return expected.length ? previous[actual.length] / expected.length : actual.length ? 1 : 0;
}
export async function convert({ account, key, file, bytes, mime, request = fetch }) {
  const body = new FormData();
  body.append('files', new Blob([bytes], { type: mime }), file);
  // Do not request translation or image descriptions in a different language.
  body.append('conversionOptions', JSON.stringify({ pdf: { metadata: false } }));
  const started = Date.now();
  let response;
  try {
    response = await request(
      `https://api.cloudflare.com/client/v4/accounts/${account}/ai/tomarkdown`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body,
        signal: AbortSignal.timeout(60000),
        redirect: 'error',
      },
    );
  } catch {
    return { file, status: 'transport_error', stop: true, elapsed_ms: Date.now() - started };
  }
  const base = { file, http_status: response.status, elapsed_ms: Date.now() - started };
  if (!response.ok) {
    await response.body?.cancel();
    return { ...base, status: 'http_error', stop: true };
  }
  let raw = '';
  try {
    const reader = response.body.getReader();
    let size = 0;
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) {
        await reader.cancel();
        return { ...base, status: 'response_limit', stop: true };
      }
      chunks.push(Buffer.from(value));
    }
    raw = Buffer.concat(chunks).toString('utf8');
    const decoded = JSON.parse(raw);
    const result = decoded.result?.[0];
    if (
      decoded.success !== true ||
      !result ||
      result.format === 'error' ||
      typeof result.data !== 'string'
    )
      return { ...base, status: 'conversion_error', stop: false };
    if (result.data.length > 20000) return { ...base, status: 'output_limit', stop: true };
    // Only known synthetic input/output text is saved; never save full HTTP bodies or headers.
    return {
      ...base,
      status: 'ok',
      format: result.format,
      text: result.data,
      tokens: Number.isFinite(result.tokens) ? result.tokens : null,
      stop: false,
    };
  } catch {
    return { ...base, status: 'invalid_response', stop: true };
  }
}
async function main() {
  const fixtures = await Promise.all(
    cases.map(async (item) => ({
      ...item,
      bytes: await readFile(`doc/fixtures/books/${item.file}`),
    })),
  );
  if (!process.argv.includes('--live')) {
    console.log(
      JSON.stringify(
        { mode: 'dry-run', maximum_requests: 4, files: cases.map(({ file }) => file) },
        null,
        2,
      ),
    );
    return;
  }
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const key = process.env.CLOUDFLARE_API_KEY;
  if (!account || !/^[a-f0-9]{32}$/i.test(account) || !key?.trim())
    throw new Error('cloudflare_credentials_missing_or_invalid');
  const results = [];
  for (const item of fixtures) {
    const result = await convert({ account, key, ...item });
    // Defensive redaction applies even to unexpected provider text that echoes credentials.
    if (result.text)
      result.text = result.text.split(key).join('[redacted]').split(account).join('[redacted]');
    if (result.status === 'ok' && item.reference) {
      result.letter_cer = characterErrorRate(normalize(item.reference), normalize(result.text));
      result.diacritic_cer = characterErrorRate(
        normalize(item.reference, true),
        normalize(result.text, true),
      );
    }
    results.push(result);
    console.log(
      `${item.file}: ${result.status}${result.http_status ? ` (HTTP ${result.http_status})` : ''}`,
    );
    if (result.stop) break;
  }
  const report = {
    tested_at: new Date().toISOString(),
    provider: 'cloudflare-tomarkdown',
    requests: results.length,
    maximum_requests: 4,
    automatic_retries: 0,
    inputs: 'repository-owned synthetic fixtures only',
    billed_cost: 'not supplied by this endpoint; check account usage',
    results,
  };
  await writeFile('doc/evidence/cloudflare-markdown.json', JSON.stringify(report, null, 2) + '\n');
  console.log('Saved synthetic results to doc/evidence/cloudflare-markdown.json');
  if (results.some((r) => r.status !== 'ok')) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error(
      'Cloudflare evaluation failed; no credentials or provider error bodies were logged.',
    );
    process.exitCode = 1;
  });
}

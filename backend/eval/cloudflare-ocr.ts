import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdir, open, readFile } from 'node:fs/promises';
import { URL, fileURLToPath } from 'node:url';
import {
  CloudflareVisionOCR,
  CLOUDFLARE_OCR_MODEL,
  OCR_OUTPUT_TOKENS,
} from '../src/cloudflare-ocr';
import type { PageOCR } from '../src/page-ocr';

const fixture = new URL('../../doc/fixtures/books/arabic-counting-vocalized.png', import.meta.url);
const report = new URL('../../.cache/cloudflare-ocr-evaluation.json', import.meta.url);
const OWNED_FIXTURE_SHA256 = '644880637af400b9c40e384d1c86c598daab4e92544a5149491656cbf320a37a';

export function verifyOwnedFixture(image: Uint8Array): void {
  if (createHash('sha256').update(image).digest('hex') !== OWNED_FIXTURE_SHA256)
    throw new Error('owned_fixture_changed');
}

// The CLI has no arbitrary file/URL or model argument. Only this exact owned image can leave the process.
export async function evaluateOwnedFixture(
  ocr: PageOCR,
  image: Uint8Array,
  output: URL,
): Promise<void> {
  verifyOwnedFixture(image);
  // Claim before network: concurrent invocations and interrupted runs cannot silently repeat spend.
  const handle = await open(output, 'wx', 0o600);
  try {
    await handle.writeFile('{"status":"started","automatic_retries":0}\n');
    const result = await ocr.transcribe(image, 'ar');
    await handle.truncate(0);
    await handle.write(
      JSON.stringify(
        {
          tested_at: new Date().toISOString(),
          fixture: 'arabic-counting-vocalized.png',
          fixture_sha256: OWNED_FIXTURE_SHA256,
          requests: 1,
          automatic_retries: 0,
          inputs: 'repository-owned synthetic fixture only',
          billed_cost: 'Not verified. Token-based cost is an estimate; check Cloudflare usage.',
          result,
        },
        null,
        2,
      ) + '\n',
      0,
      'utf8',
    );
  } finally {
    await handle.close();
  }
}

async function main() {
  if (process.argv.slice(2).some((arg) => arg !== '--live'))
    throw new Error('unsupported_argument');
  const image = await readFile(fixture);
  verifyOwnedFixture(image);
  if (!process.argv.includes('--live')) {
    console.log(
      JSON.stringify(
        {
          mode: 'dry-run',
          model: CLOUDFLARE_OCR_MODEL,
          prompt_version: 'ocr.ar.v1',
          maximum_requests: 1,
          automatic_retries: 0,
          max_completion_tokens: OCR_OUTPUT_TOKENS,
          fixture: 'arabic-counting-vocalized.png',
          bytes: image.length,
        },
        null,
        2,
      ),
    );
    return;
  }
  const ocr = new CloudflareVisionOCR(
    process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
    process.env.CLOUDFLARE_API_KEY ?? '',
  );
  await mkdir(new URL('../../.cache/', import.meta.url), { recursive: true });
  await evaluateOwnedFixture(ocr, image, report);
  console.log('Saved synthetic OCR result to .cache/cloudflare-ocr-evaluation.json.');
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error(
      'OCR evaluation stopped. Check credentials and any existing report; no retry was made.',
    );
    process.exitCode = 1;
  });
}

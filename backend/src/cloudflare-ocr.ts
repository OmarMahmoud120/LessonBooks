import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { DomainError } from './domain';
import type { PageOCR, PageOCRResult } from './page-ocr';

export const CLOUDFLARE_OCR_MODEL = '@cf/google/gemma-4-26b-a4b-it';
export const OCR_OUTPUT_TOKENS = 2048;
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_IMAGE_BYTES = 1_000_000;
export type OCRTransport = (url: string, init: RequestInit) => Promise<Response>;
// Source: Cloudflare model page, checked 2026-11-05. These are estimates, not invoices.
export function estimateOCRCost(input: number, output: number): number {
  return (input * 0.1 + output * 0.3) / 1_000_000;
}

// Owned-fixture evaluation adapter; runtime selection enforces approval and source restrictions.
// One instance permits one attempted request, including failures and indeterminate timeouts.
export class CloudflareVisionOCR implements PageOCR {
  readonly maxPages = 1;
  readonly languages = ['ar'] as const;
  #attempted = false;

  constructor(
    private account: string,
    private key: string,
    private send: OCRTransport = fetch,
  ) {
    if (!/^[a-f0-9]{32}$/i.test(account) || !key.trim() || /[\r\n]/.test(key) || key.length > 4096)
      throw new DomainError('ocr_credentials_invalid', 503);
  }

  async transcribe(image: Uint8Array, language: string): Promise<PageOCRResult> {
    if (language !== 'ar') throw new DomainError('ocr_language_not_supported');
    if (this.#attempted) throw new DomainError('ocr_request_limit');
    if (image.length > MAX_IMAGE_BYTES) throw new DomainError('ocr_image_limit');
    const png = Buffer.from(image);
    if (
      png.length < 33 ||
      png.length > MAX_IMAGE_BYTES ||
      !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      png.readUInt32BE(8) !== 13 ||
      png.toString('ascii', 12, 16) !== 'IHDR' ||
      png.readUInt32BE(16) < 1 ||
      png.readUInt32BE(16) > 2400 ||
      png.readUInt32BE(20) < 1 ||
      png.readUInt32BE(20) > 2400
    )
      throw new DomainError('ocr_image_limit');
    const prompt = (
      await readFile(new URL('../prompts/ocr.ar.v1.md', import.meta.url), 'utf8')
    ).trim();
    // Set before awaiting transport so concurrent calls and failed calls cannot spend twice.
    if (this.#attempted) throw new DomainError('ocr_request_limit');
    this.#attempted = true;
    let response: Response;
    try {
      response = await this.send(
        `https://api.cloudflare.com/client/v4/accounts/${this.account}/ai/v1/chat/completions`,
        {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(120_000),
          headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: CLOUDFLARE_OCR_MODEL,
            stream: false,
            store: false,
            temperature: 0,
            max_completion_tokens: OCR_OUTPUT_TOKENS,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: prompt },
                  {
                    type: 'image_url',
                    image_url: { url: `data:image/png;base64,${png.toString('base64')}` },
                  },
                ],
              },
            ],
          }),
        },
      );
    } catch {
      throw new DomainError('ocr_transport_failed', 502);
    }
    if (!response.ok) {
      // Provider error bodies may contain secrets or source text. Never read or expose them.
      await response.body?.cancel().catch(() => undefined);
      throw new DomainError('ocr_provider_rejected', 502);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new DomainError('ocr_invalid_response', 502);
    let size = 0;
    const chunks: Uint8Array[] = [];
    let data: {
      choices?: {
        finish_reason?: unknown;
        message?: { content?: unknown; tool_calls?: unknown };
      }[];
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
    };
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) throw new Error('response_limit');
        chunks.push(value);
      }
      data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof data;
      if (data === null || typeof data !== 'object' || !Array.isArray(data.choices))
        throw new Error('invalid_response');
    } catch {
      await reader.cancel().catch(() => undefined);
      throw new DomainError('ocr_invalid_response', 502);
    } finally {
      reader.releaseLock();
    }
    const choice = data.choices?.[0];
    if (choice?.finish_reason !== 'stop') throw new DomainError('ocr_incomplete', 502);
    const text = choice.message?.content;
    if (
      typeof text !== 'string' ||
      !text.trim() ||
      text.length > 20_000 ||
      choice.message?.tool_calls !== undefined ||
      text.includes(this.key) ||
      text.includes(this.account)
    )
      throw new DomainError('ocr_invalid_output', 502);
    const input = data.usage?.prompt_tokens;
    const output = data.usage?.completion_tokens;
    if (
      typeof input !== 'number' ||
      !Number.isSafeInteger(input) ||
      input < 1 ||
      input > 256_000 ||
      typeof output !== 'number' ||
      !Number.isSafeInteger(output) ||
      output < 1 ||
      output > OCR_OUTPUT_TOKENS
    )
      throw new DomainError('ocr_invalid_usage', 502);
    return {
      text: text.trim(),
      provider: 'cloudflare',
      model: CLOUDFLARE_OCR_MODEL,
      prompt_version: 'ocr.ar.v1',
      prompt_tokens: input,
      completion_tokens: output,
      estimated_cost_usd: estimateOCRCost(input, output),
    };
  }
}

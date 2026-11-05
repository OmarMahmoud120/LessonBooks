import { createHash } from 'node:crypto';
import { PDFIngestor, runProcess, type Ingestor } from './ingest';
import { CloudflareVisionOCR, type OCRTransport } from './cloudflare-ocr';
import { DomainError } from './domain';
import type { RuntimeConfig } from './runtime-config';

// Immutable owned PDFs only. Unknown uploads never reach the hosted model, even with approval set.
const OWNED_PDFS = new Set([
  '0d00780dc5d6cf26b1538307f62d4350bf69ee4917bb0a5450beb6bb9bd75d42',
  'fea96778ec89e35b6a9722cbb179252d053d1a301d1f13f0497d08d8dd278106',
  'a480af9cf248f3d2f609f3c4570b3776e1981e3121a3bbf9d5b1e603ca452dbb',
  'ea9cc18fa8842f1f149866b72e2155c5ee5affc4ec78c3d87092f0c91d8fdff0',
]);

export function createRuntimeIngestor(
  config: RuntimeConfig,
  env: Record<string, string | undefined>,
  dependencies: { run?: typeof runProcess; send?: OCRTransport } = {},
): Ingestor {
  const run = dependencies.run ?? runProcess;
  if (config.ocrProvider === 'local' || config.role === 'api')
    return new PDFIngestor(config.requireScan, run);
  // Defense in depth for callers constructing RuntimeConfig directly rather than parsing env.
  if (config.mode !== 'emulator' || env.CLOUDFLARE_OCR_APPROVED !== 'true')
    throw new DomainError('ocr_runtime_not_approved', 503);
  if (
    !Number.isInteger(config.ocrMaxRequests) ||
    config.ocrMaxRequests < 1 ||
    config.ocrMaxRequests > 4
  )
    throw new DomainError('ocr_request_limit_invalid', 503);
  const account = env.CLOUDFLARE_ACCOUNT_ID ?? '';
  const key = env.CLOUDFLARE_API_KEY ?? '';
  const makeOCR = () => new CloudflareVisionOCR(account, key, dependencies.send);
  // Validate injected credentials at startup, without retaining them in RuntimeConfig or logs.
  let firstOCR: CloudflareVisionOCR | undefined = makeOCR();
  let remaining = config.ocrMaxRequests;
  return {
    async extract(bytes, language, sink, beforeHostedOCR) {
      if (bytes.length > 15 * 1024 * 1024) throw new DomainError('upload_too_large');
      if (!OWNED_PDFS.has(createHash('sha256').update(bytes).digest('hex')))
        throw new DomainError('ocr_synthetic_source_required');
      const ocr = firstOCR ?? makeOCR();
      firstOCR = undefined;
      return new PDFIngestor(config.requireScan, run, {
        maxPages: ocr.maxPages,
        languages: ocr.languages,
        async transcribe(image, sourceLanguage) {
          if (!beforeHostedOCR) throw new DomainError('ocr_job_context_required');
          if (remaining <= 0) throw new DomainError('ocr_request_limit');
          // Persist the attempt before transport. Failed/indeterminate attempts cannot be retried.
          await beforeHostedOCR();
          if (remaining <= 0) throw new DomainError('ocr_request_limit');
          remaining--;
          return ocr.transcribe(image, sourceLanguage);
        },
      }).extract(bytes, language, sink);
    },
  };
}

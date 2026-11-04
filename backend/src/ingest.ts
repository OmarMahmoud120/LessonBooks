import { Worker } from 'node:worker_threads';
import { URL } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DomainError } from './domain';

export type ExtractedBook = {
  pages: { page: number; text: string; language?: 'en' | 'ar' }[];
  language: string;
  images: { page: number; asset_id: string }[];
};
// Persisted page images inherit family storage scoping and deletion.
export type ImageSink = (page: number, bytes: Uint8Array) => Promise<string>;
export const SUPPORTED_LANGUAGES = ['en-GB', 'ar'] as const;
export interface Ingestor {
  extract(bytes: Uint8Array, language?: string, sink?: ImageSink): Promise<ExtractedBook>;
}
export function runProcess(command: string, args: string[], timeout = 60000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new DomainError('parser_timeout'));
    }, timeout);
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
      if (output.length > 500000) {
        child.kill('SIGKILL');
        reject(new DomainError('parser_output_limit'));
      }
    });
    child.on('error', () => {
      clearTimeout(timer);
      reject(new DomainError('parser_dependency_unavailable', 503));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new DomainError('parser_rejected_pdf'));
    });
  });
}
// Tesseract traineddata selection follows the explicit kid language, never content guessing.
export function ocrLanguages(language: string): string {
  return language.split('-')[0] === 'ar' ? 'ara+eng' : 'eng';
}
// Arabic connected-script accuracy needs a higher rasterization scale than Latin pages.
export function ocrScale(language: string): number {
  return language.split('-')[0] === 'ar' ? 2400 : 1800;
}
// NFKC folds Arabic presentation forms into canonical letters; tatweel is pure stretch.
export function normalizeText(text: string): string {
  return text.normalize('NFKC').replace(/\u0640/g, '');
}
export function detectPageLanguage(text: string, fallback: string): 'en' | 'ar' {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (!letters.length) return fallback.split('-')[0] === 'ar' ? 'ar' : 'en';
  const arabic = text.match(/\p{Script=Arabic}/gu) ?? [];
  return arabic.length > letters.length * 0.4 ? 'ar' : 'en';
}
export class PDFIngestor implements Ingestor {
  constructor(
    private requireScan = false,
    private run = runProcess,
  ) {}
  async extract(bytes: Uint8Array, language = 'en-GB', sink?: ImageSink): Promise<ExtractedBook> {
    if (!(SUPPORTED_LANGUAGES as readonly string[]).includes(language))
      throw new DomainError('unsupported_source_language');
    if (bytes.length > 15 * 1024 * 1024) throw new DomainError('upload_too_large');
    const dir = await mkdtemp(join(tmpdir(), 'lessonbooks-ingest-'));
    const path = join(dir, 'book.pdf');
    await writeFile(path, bytes);
    try {
      if (this.requireScan) await this.run('clamscan', ['--no-summary', '--', path]);
      const extracted = await parsePDF(bytes);
      {
        const pages: ExtractedBook['pages'] = [];
        const images: ExtractedBook['images'] = [];
        let total = 0;
        for (let pageNumber = 1; pageNumber <= extracted.length; pageNumber++) {
          let text = extracted[pageNumber - 1]!.text;
          // pdf.js scrambles Arabic letter order inside ligature clusters, so Arabic pages
          // always take the OCR path, which emits logical-order text from the rasterization.
          const arabicBook = language.split('-')[0] === 'ar';
          if (text.length < 12 || arabicBook) {
            const prefix = join(dir, `page-${pageNumber}`);
            await this.run('pdftoppm', [
              '-f',
              String(pageNumber),
              '-l',
              String(pageNumber),
              '-singlefile',
              '-scale-to',
              String(ocrScale(language)),
              '-png',
              path,
              prefix,
            ]);
            text = (
              await this.run('tesseract', [
                prefix + '.png',
                'stdout',
                '-l',
                ocrLanguages(language),
                '--oem',
                '1',
                '--psm',
                '3',
              ])
            ).trim();
            if (sink)
              images.push({
                page: pageNumber,
                asset_id: await sink(pageNumber, await readFile(prefix + '.png')),
              });
          }
          text = normalizeText(text);
          total += text.length;
          if (total > 60000) throw new DomainError('extracted_text_limit');
          if (!text) throw new DomainError('empty_page');
          pages.push({ page: pageNumber, text, language: detectPageLanguage(text, language) });
        }
        return { pages, language, images };
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
// An injectable implementation keeps stage tests independent from native OCR binaries.
export class FixtureIngestor implements Ingestor {
  async extract(_bytes: Uint8Array, language = 'en-GB'): Promise<ExtractedBook> {
    return {
      pages: [
        {
          page: 1,
          text: 'Count one, two, three. One and one make two. Two and one make three.',
          language: detectPageLanguage(
            'Count one, two, three. One and one make two. Two and one make three.',
            language,
          ),
        },
      ],
      language,
      images: [],
    };
  }
}
// Read extracted page images only inside the isolated worker's temporary directory.
export async function extractedFiles(dir: string) {
  return Promise.all(
    (await readdir(dir))
      .filter((p) => p.endsWith('.png'))
      .map(async (p) => ({ name: p, bytes: await readFile(join(dir, p)) })),
  );
}

function parsePDF(bytes: Uint8Array): Promise<{ page: number; text: string }[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pdf-worker.mjs', import.meta.url), {
      // The parser is plain JavaScript; do not inherit the parent's TS loader/IPC hooks.
      execArgv: [],
      workerData: { bytes },
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 },
    });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new DomainError('parser_timeout'));
    }, 45000);
    worker.once(
      'message',
      (result: { pages?: { page: number; text: string }[]; error?: string }) => {
        clearTimeout(timer);
        void worker.terminate();
        if (result.pages) resolve(result.pages);
        else reject(new DomainError(result.error ?? 'parser_rejected_pdf'));
      },
    );
    worker.once('error', () => {
      clearTimeout(timer);
      reject(new DomainError('parser_rejected_pdf'));
    });
    worker.once('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new DomainError('parser_rejected_pdf'));
    });
  });
}

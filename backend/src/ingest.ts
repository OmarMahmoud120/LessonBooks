import { Worker } from 'node:worker_threads';
import { URL } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DomainError } from './domain';

export type ExtractedBook = {
  pages: { page: number; text: string }[];
  language: string;
  images: { page: number; asset_id: string }[];
};
export interface Ingestor {
  extract(bytes: Uint8Array): Promise<ExtractedBook>;
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
export class PDFIngestor implements Ingestor {
  constructor(
    private requireScan = false,
    private run = runProcess,
  ) {}
  async extract(bytes: Uint8Array): Promise<ExtractedBook> {
    if (bytes.length > 15 * 1024 * 1024) throw new DomainError('upload_too_large');
    const dir = await mkdtemp(join(tmpdir(), 'lessonbooks-ingest-'));
    const path = join(dir, 'book.pdf');
    await writeFile(path, bytes);
    try {
      if (this.requireScan) await this.run('clamscan', ['--no-summary', '--', path]);
      const extracted = await parsePDF(bytes);
      {
        const pages: ExtractedBook['pages'] = [];
        let total = 0;
        for (let pageNumber = 1; pageNumber <= extracted.length; pageNumber++) {
          let text = extracted[pageNumber - 1]!.text;
          if (text.length < 12) {
            const prefix = join(dir, `page-${pageNumber}`);
            await this.run('pdftoppm', [
              '-f',
              String(pageNumber),
              '-l',
              String(pageNumber),
              '-singlefile',
              '-scale-to',
              '1800',
              '-png',
              path,
              prefix,
            ]);
            text = (
              await this.run('tesseract', [prefix + '.png', 'stdout', '-l', 'eng', '--psm', '3'])
            ).trim();
          }
          total += text.length;
          if (total > 60000) throw new DomainError('extracted_text_limit');
          if (!text) throw new DomainError('empty_page');
          pages.push({ page: pageNumber, text });
        }
        const joined = pages.map((p) => p.text).join(' ');
        const arabic = (joined.match(/[\u0600-\u06ff]/g) ?? []).length;
        if (arabic > joined.length / 3) throw new DomainError('unsupported_source_language');
        return { pages, language: 'en-GB', images: [] };
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
// An injectable implementation keeps stage tests independent from native OCR binaries.
export class FixtureIngestor implements Ingestor {
  async extract(): Promise<ExtractedBook> {
    return {
      pages: [
        { page: 1, text: 'Count one, two, three. One and one make two. Two and one make three.' },
      ],
      language: 'en-GB',
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

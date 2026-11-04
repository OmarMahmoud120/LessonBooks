// Optional page OCR is injectable; the deployed worker still uses local Tesseract.
export type PageOCRResult = {
  text: string;
  provider: string;
  model: string;
  prompt_version: string;
  prompt_tokens: number;
  completion_tokens: number;
  estimated_cost_usd: number;
};
export interface PageOCR {
  readonly maxPages: number;
  readonly languages: readonly string[];
  transcribe(image: Uint8Array, language: string): Promise<PageOCRResult>;
}

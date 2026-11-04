export type Kid = {
  id: string;
  nickname: string;
  avatar: 'fox' | 'owl' | 'cat';
  age_band: '5-7' | '6-8';
  country: 'GB-ENG';
  language: 'en-GB' | 'ar';
  curriculum_id: 'england-national-2014';
  grade_id: 'year-1' | 'year-2';
  reading_level: 'emerging' | 'developing';
  state: 'active' | 'deleting';
};
export type Parent = {
  id: string;
  state: 'active' | 'deleting' | 'deleted';
  preferred_language: string;
  country: string;
  created_at: string;
  pin_hash?: string;
  pin_salt?: string;
  pin_updated_at?: string;
  pin_failed_count?: number;
  pin_locked_until?: number;
};
export type Consent = {
  id: string;
  type: 'privacy' | 'content_rights';
  version: '2026-11-03';
  granted_at: string;
  method: 'parent_confirmation';
};
export type Book = {
  id: string;
  kid_id: string;
  subject: 'mathematics';
  language: string;
  source_path: string;
  sha256: string;
  status: 'uploaded' | 'processing' | 'ready' | 'failed';
  created_at: string;
};
export const STAGES = ['ingest', 'structure', 'plan', 'generate', 'validate', 'publish'] as const;
export type Stage = (typeof STAGES)[number];
export type Usage = {
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  estimated: boolean;
  purpose: 'decision' | Stage;
};
export type Job = {
  id: string;
  book_id: string;
  kid_id: string;
  stage: Stage;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  attempt: number;
  fence: number;
  lease_until: number;
  next_attempt_at: number;
  created_at: string;
  error_code?: string;
  output_path?: string;
  usage: Usage[];
  budget_usd: number;
  reserved_usd: number;
  repair_count: number;
  prompt_version: string;
  policy_version: string;
  outbox_pending: boolean;
};
export type LessonRecord = {
  id: string;
  kid_id: string;
  book_id: string;
  revision: number;
  order: number;
  status: 'draft' | 'approved' | 'archived';
  schema_version: '1.0.0';
  storage_path: string;
  summary: string;
  approved_at?: string;
};
export class DomainError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
export function safeId(value: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new DomainError('invalid_id');
  return value;
}
export function familyPath(uid: string, collection?: string, id?: string): string {
  const root = `parents/${safeId(uid)}`;
  return collection ? `${root}/${safeId(collection)}${id ? `/${safeId(id)}` : ''}` : root;
}

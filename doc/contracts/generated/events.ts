/* Generated from doc/specs. Run npm run contracts:generate. */

export interface LessonEvent {
  event_id: string;
  schema_version: '1.0.0';
  lesson_id: string;
  lesson_revision: number;
  type: 'started' | 'answered' | 'hint_used' | 'completed' | 'score';
  timestamp: string;
  activity_id?: string;
  score?: number;
  max_score?: number;
  duration_ms?: number;
}

export type SourceType = 'article' | 'paper' | 'podcast' | 'video' | 'tech_doc' | 'project_repo';
export const SOURCE_TYPES: readonly SourceType[];
export class KeeperError extends Error { code: string; details: Record<string, unknown>; }
export interface MediaRecord {
  id: string; title: string; abstract: string; source: string; source_type: SourceType;
  author: string | null; link: string | null; copied_lark_link: string | null;
  source_created_at: string | null; created_at: string; updated_at: string;
}
export interface MediaFilters {
  title?: string; source?: string; author?: string; source_type?: SourceType;
  dayStart?: string; dayEnd?: string; page: number; page_size: number;
  sort_by: 'created_at' | 'source_created_at' | 'title'; sort_order: 'asc' | 'desc';
}
export function parseMediaQuery(input: unknown): MediaFilters;
export function publishedBounds(range: string, now?: Date): { dayStart?: string; dayEnd?: string };
export function dayBounds(day: string): { dayStart: string; dayEnd: string };
export function serializeMediaRecord(row: MediaRecord): MediaRecord;

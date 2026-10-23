import type { SourceType } from '@media-keeper/core'

export const sourceLabels: Record<SourceType, string> = {
  article: '文章', paper: '论文', podcast: '播客', video: '视频', tech_doc: '技术文档', project_repo: '项目仓库',
}
export const sourceTypes = Object.keys(sourceLabels) as SourceType[]
export const publishedLabels = { all: '全部', today: '今日发布', week: '一周内发布', month: '一个月内发布', year: '一年内发布' }
export const sortOptions = {
  newest: { label: '收藏时间 · 最新优先', field: 'created_at', order: 'desc' },
  oldest: { label: '收藏时间 · 最早优先', field: 'created_at', order: 'asc' },
  published: { label: '发布时间 · 最新优先', field: 'source_created_at', order: 'desc' },
} as const
export interface Filters { title: string; published: keyof typeof publishedLabels; source_type: SourceType | ''; page: number; sort: keyof typeof sortOptions }
function hasOwn<T extends object>(object: T, key: string): key is Extract<keyof T, string> { return Object.hasOwn(object, key) }
export function readFilters(search: string): Filters {
  const params = new URLSearchParams(search)
  const published = params.get('published') ?? 'all', type = params.get('source_type') ?? '', sort = params.get('sort') ?? 'newest'
  const page = params.get('page') ?? '1'
  return { title: [...(params.get('title') ?? '').trim()].slice(0, 512).join(''),
    published: hasOwn(publishedLabels, published) ? published : 'all',
    source_type: hasOwn(sourceLabels, type) ? type : '',
    sort: hasOwn(sortOptions, sort) ? sort : 'newest',
    page: /^[1-9]\d*$/.test(page) && Number(page) <= 1000000 ? Number(page) : 1 }
}
export function filterSearch(filters: Filters) {
  const params = new URLSearchParams()
  if (filters.title) params.set('title', filters.title)
  if (filters.published !== 'all') params.set('published', filters.published)
  if (filters.source_type) params.set('source_type', filters.source_type)
  if (filters.sort !== 'newest') params.set('sort', filters.sort)
  if (filters.page > 1) params.set('page', String(filters.page))
  return params.size ? '?' + params.toString() : ''
}
export function apiSearch(filters: Filters) {
  const params = new URLSearchParams({ page: String(filters.page), page_size: '20', sort_by: sortOptions[filters.sort].field, sort_order: sortOptions[filters.sort].order })
  if (filters.title) params.set('title', filters.title)
  if (filters.published !== 'all') params.set('published', filters.published)
  if (filters.source_type) params.set('source_type', filters.source_type)
  return params.toString()
}
export function readableDate(value: string | null, includeTime = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return '未注明'
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', ...(includeTime ? { hour: '2-digit', minute: '2-digit' } as const : {}) }).format(new Date(value))
  return parts
}
export function safeLink(value: string | null) {
  if (!value) return null
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null } catch { return null }
}

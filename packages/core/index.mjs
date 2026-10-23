import { DateTime } from 'luxon';
import { createHash } from 'node:crypto';

export class KeeperError extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; }
}
export function assert(value, code, message) { if (!value) throw new KeeperError(code, message); }
export function required(value, name, max) {
  assert(typeof value === 'string' && value.trim(), 'invalid_input', `${name} 必须是非空字符串`);
  const text = value.trim();
  assert([...text].length <= max, 'invalid_input', `${name} 超出 ${max} 字符上限`);
  return text;
}
export function canonicalUrl(value) {
  if (value == null || value === '') return null;
  let u;
  try { u = new URL(value); } catch { throw new KeeperError('invalid_url', '全文入口必须是完整 HTTP(S) URL'); }
  assert(['http:', 'https:'].includes(u.protocol) && !u.username && !u.password,
    'invalid_url', '全文入口必须是无用户名和密码的 HTTP(S) URL');
  for (const k of [...u.searchParams.keys()]) {
    if (/^(utm_.+|fbclid|gclid|msclkid)$/i.test(k)) u.searchParams.delete(k);
    else assert(!/(^|[_-])(access_token|token|auth|authorization|api_key|apikey|password|secret|signature|sig|credential|session|sessionid)($|[_-])/i.test(k) && !/^x-amz-/i.test(k),
      'private_url', '原链接包含登录凭证或临时签名，请改用完整内容的飞书副本');
  }
  if (!/^#(!?\/)/.test(u.hash)) u.hash = '';
  u.searchParams.sort();
  return u.href;
}
export function larkUrl(value) {
  const url = canonicalUrl(value);
  if (!url) return null;
  const u = new URL(url);
  assert(/(^|\.)(feishu\.cn|larksuite\.com)$/.test(u.hostname) && /^\/(docx|wiki)\//.test(u.pathname),
    'invalid_copy_url', 'copied_lark_link 必须是飞书/Lark 文档 URL');
  return url;
}
export function sourceDate(value) {
  if (value == null || value === '') return { value: null };
  if (typeof value !== 'string') return { value: null, warning: '来源时间无法解析，已置空' };
  const s = value.trim();
  // Do not interpret partial dates such as a year or month as an exact date.
  let d;
  if (/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(s)) {
    d = DateTime.fromISO(s.replace(' ', 'T'), { zone: 'Asia/Shanghai', setZone: true });
  } else if (/^[A-Za-z]{3},?\s/.test(s)) d = DateTime.fromRFC2822(s, { zone: 'Asia/Shanghai', setZone: true });
  if (!d?.isValid) return { value: null, warning: '来源时间无法可靠解析，已置空' };
  const fraction = s.match(/:\d{2}\.(\d{1,6})/)?.[1]?.padEnd(6, '0') || '000000';
  return { value: d.toUTC().toFormat('yyyy-MM-dd HH:mm:ss') + '.' + fraction };
}
export function normalizeRecord(input, types) {
  const title = required(input.title, 'title', 512);
  const abstract = required(input.abstract, 'abstract', 400);
  const source = input.source == null || input.source === '' ? '来源未注明' : required(input.source, 'source', 255);
  assert(types.includes(input.source_type), 'invalid_type', `source_type 必须是 ${types.join(', ')} 之一`);
  const author = Array.isArray(input.author) ? input.author.map(x => required(x, 'author', 16000)).join('、') : input.author;
  assert(author == null || typeof author === 'string', 'invalid_input', 'author 必须是字符串、作者数组或 null');
  const time = sourceDate(input.source_created_at);
  const link = canonicalUrl(input.link);
  const copied_lark_link = larkUrl(input.copied_lark_link);
  assert(link || copied_lark_link || input.copy_markdown_path, 'missing_full_text', '必须提供可用原链接或完整正文的飞书副本');
  return { record: { title, abstract, link, copied_lark_link, source, source_type: input.source_type,
    author: author?.trim() || null, source_created_at: time.value }, warnings: time.warning ? [time.warning] : [] };
}
export function parseTypes(definition) {
  assert(/^enum\(/i.test(definition), 'schema_mismatch', 'source_type 不是 ENUM');
  return [...definition.matchAll(/'((?:[^'\\]|\\.|'')*)'/g)].map(m => m[1].replace(/''/g, "'").replace(/\\(.)/g, '$1'));
}
export function jobKey(record) {
  return createHash('sha256').update(record.link || JSON.stringify([record.source, record.title])).digest('hex');
}
export function contentDigest(content) { return createHash('sha256').update(content).digest('hex'); }

export const SOURCE_TYPES = Object.freeze(['article', 'paper', 'podcast', 'video', 'tech_doc', 'project_repo']);
export function dayBounds(day) {
  assert(typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day), 'invalid_query', 'source_created_at 必须是 YYYY-MM-DD');
  const start = DateTime.fromISO(day, { zone: 'Asia/Shanghai' });
  const end = start.plus({ days: 1 });
  assert(start.isValid && start.toISODate() === day && start.year >= 1000 && end.year <= 9999,
    'invalid_query', 'source_created_at 必须是有效日期');
  return { dayStart: start.toUTC().toFormat('yyyy-MM-dd HH:mm:ss'), dayEnd: end.toUTC().toFormat('yyyy-MM-dd HH:mm:ss') };
}
export function publishedBounds(range, now = new Date()) {
  assert(['today', 'week', 'month', 'year', 'all'].includes(range), 'invalid_query', 'published 必须是 today/week/month/year/all');
  if (range === 'all') return {};
  const today = DateTime.fromJSDate(now, { zone: 'Asia/Shanghai' }).startOf('day');
  const end = today.plus({ days: 1 });
  const start = range === 'today' ? today : end.minus(range === 'week' ? { weeks: 1 } : range === 'month' ? { months: 1 } : { years: 1 });
  return { dayStart: start.toUTC().toFormat('yyyy-MM-dd HH:mm:ss'), dayEnd: end.toUTC().toFormat('yyyy-MM-dd HH:mm:ss') };
}
export function parseMediaQuery(input = {}) {
  const keys = ['title', 'source', 'source_type', 'author', 'source_created_at', 'published', 'page', 'page_size', 'sort_by', 'sort_order'];
  assert(input && typeof input === 'object' && !Array.isArray(input), 'invalid_query', '查询参数无效');
  for (const [key, value] of Object.entries(input)) {
    assert(keys.includes(key), 'invalid_query', `不支持的查询参数：${key}`);
    assert(typeof value === 'string', 'invalid_query', `${key} 只能提供一个字符串值`);
  }
  const output = {};
  for (const [key, max] of [['title', 512], ['source', 255], ['author', 512]]) {
    if (input[key]?.trim()) {
      assert([...input[key].trim()].length <= max, 'invalid_query', `${key} 超过 ${max} 字符`);
      output[key] = input[key].trim();
    }
  }
  if (input.source_type) {
    assert(SOURCE_TYPES.includes(input.source_type), 'invalid_query', 'source_type 不在支持的六种类型中');
    output.source_type = input.source_type;
  }
  assert(!(input.source_created_at && input.published), 'invalid_query', 'source_created_at 与 published 不能同时使用');
  if (input.source_created_at) Object.assign(output, dayBounds(input.source_created_at));
  if (input.published) Object.assign(output, publishedBounds(input.published));
  for (const [key, fallback, max] of [['page', 1, 1000000], ['page_size', 20, 100]]) {
    const value = input[key] ?? String(fallback);
    assert(/^[1-9]\d*$/.test(value) && Number(value) <= max, 'invalid_query', `${key} 必须是 1 到 ${max} 的整数`);
    output[key] = Number(value);
  }
  output.sort_by = input.sort_by ?? 'created_at';
  output.sort_order = input.sort_order ?? 'desc';
  assert(['created_at', 'source_created_at', 'title'].includes(output.sort_by), 'invalid_query', 'sort_by 无效');
  assert(['asc', 'desc'].includes(output.sort_order), 'invalid_query', 'sort_order 无效');
  return output;
}
export function serializeMediaRecord(row) {
  const result = { ...row, id: String(row.id) };
  for (const key of ['source_created_at', 'created_at', 'updated_at']) {
    result[key] = row[key] == null ? null : row[key].replace(' ', 'T') + 'Z';
  }
  return result;
}

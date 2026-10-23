import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { assert, canonicalUrl, larkUrl, parseTypes, SOURCE_TYPES } from '@media-keeper/core';

export const columns = ['title','abstract','link','copied_lark_link','source','source_type','author','source_created_at'];
const select = 'SELECT id,title,abstract,link,copied_lark_link,source,source_type,author,source_created_at,created_at,updated_at FROM useful_docs';
export async function connect(config) {
  const db = await mysql.createConnection(connectionOptions(config));
  await db.query("SET time_zone = '+00:00'");
  await db.query("SET SESSION sql_mode = CONCAT_WS(',', @@sql_mode, 'STRICT_ALL_TABLES')");
  return db;
}
export async function types(db) {
  const [rows] = await db.query("SHOW COLUMNS FROM useful_docs LIKE 'source_type'");
  assert(rows.length === 1, 'schema_mismatch', '找不到 useful_docs.source_type');
  return parseTypes(rows[0].Type);
}
export async function get(db, id) {
  assert(/^\d+$/.test(String(id)), 'invalid_id', 'id 必须是正整数');
  const [rows] = await db.execute(`${select} WHERE id=?`, [String(id)]);
  assert(rows.length === 1, 'not_found', '未找到该收藏');
  return rows[0];
}
export async function find(db, input, excludeId = null) {
  const link = canonicalUrl(input.link), copy = larkUrl(input.copied_lark_link);
  // A binary comparison preserves case-sensitive URL paths and query values.
  let exact = [];
  if (link || copy) {
    const [rows] = await db.execute(`${select} WHERE (BINARY link IN (?,?) OR BINARY copied_lark_link IN (?,?)) ORDER BY id`, [link, copy, link, copy]);
    exact = rows.filter(r => String(r.id) !== String(excludeId));
  }
  if (exact.length) return { status: 'existing', records: exact };
  if (typeof input.title === 'string' && typeof input.source === 'string') {
    const [rows] = await db.execute(`${select} WHERE title=? AND source=? ORDER BY id LIMIT 20`, [input.title.trim(), input.source.trim()]);
    const candidates = rows.filter(r => String(r.id) !== String(excludeId));
    if (candidates.length) return { status: 'candidates', records: candidates };
  }
  return { status: 'new', records: [] };
}

export async function readDatabaseConfig(file) {
  const stat = await fs.stat(file);
  assert((stat.mode & 0o077) === 0, 'config_permissions', '配置文件必须只允许所有者读写（0600）');
  const config = JSON.parse(await fs.readFile(file, 'utf8'));
  assert(config.mysql?.database === 'agent' && config.mysql.user && config.mysql.password,
    'invalid_config', '缺少 agent 数据库专用连接配置');
  return config;
}
export function connectionOptions(config) {
  return { ...config.mysql, charset: 'utf8mb4', timezone: 'Z', dateStrings: true,
    supportBigNumbers: true, bigNumberStrings: true, multipleStatements: false, connectTimeout: 10000 };
}
export function createDatabasePool(config) {
  return mysql.createPool({ ...connectionOptions(config), connectionLimit: 5, waitForConnections: true, queueLimit: 100 });
}
export async function acquireWriteLock(db) {
  const [rows] = await db.execute("SELECT GET_LOCK('docs_keeper:useful_docs',30) AS acquired");
  assert(Number(rows[0].acquired) === 1, 'busy', '另一个收藏正在处理，请稍后重试');
}
export async function releaseWriteLock(db) {
  await db.execute("SELECT RELEASE_LOCK('docs_keeper:useful_docs')");
}
export async function writeRecord(db, record, updateId) {
  const values = columns.map(key => record[key]);
  if (updateId) {
    await db.execute(`UPDATE useful_docs SET ${columns.map(key => key + '=?').join(',')},updated_at=UTC_TIMESTAMP(6) WHERE id=?`, [...values, String(updateId)]);
    return String(updateId);
  }
  const [result] = await db.execute(`INSERT INTO useful_docs (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`, values);
  return String(result.insertId);
}
export async function searchByTitle(db, title) {
  const [rows] = await db.execute(`${select} WHERE LOCATE(?, title)>0 ORDER BY updated_at DESC,id DESC LIMIT 50`, [title]);
  return rows;
}
export async function listMedia(db, filters) {
  const clauses = [], params = [];
  for (const key of ['title', 'source', 'author']) {
    if (filters[key]) { clauses.push(`LOCATE(?, ${key}) > 0`); params.push(filters[key]); }
  }
  if (filters.dayStart) {
    clauses.push('source_created_at >= ? AND source_created_at < ?');
    params.push(filters.dayStart, filters.dayEnd);
  }
  const facetWhere = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
  const [grouped] = await db.execute('SELECT source_type, COUNT(*) AS count FROM useful_docs' + facetWhere + ' GROUP BY source_type', params);
  const source_type_counts = Object.fromEntries(SOURCE_TYPES.map(type => [type, 0]));
  for (const row of grouped) source_type_counts[row.source_type] = Number(row.count);
  if (filters.source_type) { clauses.push('source_type = ?'); params.push(filters.source_type); }
  const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
  const allowedSorts = ['created_at', 'source_created_at', 'title'];
  assert(allowedSorts.includes(filters.sort_by) && ['asc', 'desc'].includes(filters.sort_order), 'invalid_query', '排序参数无效');
  const direction = filters.sort_order.toUpperCase();
  const nulls = filters.sort_by === 'source_created_at' ? 'source_created_at IS NULL ASC, ' : '';
  const [counts] = await db.execute('SELECT COUNT(*) AS total FROM useful_docs' + where, params);
  // Validated integers are interpolated for LIMIT/OFFSET; values remain parameterized.
  assert(Number.isInteger(filters.page) && filters.page >= 1 && filters.page <= 1000000 &&
    Number.isInteger(filters.page_size) && filters.page_size >= 1 && filters.page_size <= 100, 'invalid_query', '分页参数无效');
  const offset = (filters.page - 1) * filters.page_size;
  const [data] = await db.execute(`${select}${where} ORDER BY ${nulls}${filters.sort_by} ${direction}, id ${direction} LIMIT ${filters.page_size} OFFSET ${offset}`, params);
  const total = Number(counts[0].total);
  return { data, source_type_counts, pagination: { page: filters.page, page_size: filters.page_size, total, total_pages: Math.ceil(total / filters.page_size) } };
}

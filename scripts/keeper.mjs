#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import mysql from 'mysql2/promise';
import { assert, KeeperError, canonicalUrl, larkUrl, normalizeRecord, parseTypes, jobKey, contentDigest } from './lib.mjs';
import { callLark, readCopy } from './lark.mjs';

export const columns = ['title','abstract','link','copied_lark_link','source','source_type','author','source_created_at'];
const select = 'SELECT id,title,abstract,link,copied_lark_link,source,source_type,author,source_created_at,created_at,updated_at FROM useful_docs';
export async function readConfig(file = process.env.DOCS_KEEPER_CONFIG) {
  if (!file) {
    file = path.join(os.homedir(), '.config/docs-keeper/config.json');
    try { await fs.access(file); }
    catch (e) {
      if (e.code !== 'ENOENT') throw e;
      file = path.join(os.homedir(), '.config/docs_keeper/config.json');
    }
  }
  const stat = await fs.stat(file);
  assert((stat.mode & 0o077) === 0, 'config_permissions', '配置文件必须只允许所有者读写（0600）');
  const config = JSON.parse(await fs.readFile(file, 'utf8'));
  assert(config.mysql?.database === 'agent' && config.mysql.user && config.mysql.password, 'invalid_config', '缺少 agent 数据库专用连接配置');
  assert(config.lark?.profile && path.isAbsolute(config.lark.workspace), 'invalid_config', '缺少飞书 profile 或绝对工作区路径');
  const legacyConfig = path.resolve(file) === path.join(os.homedir(), '.config/docs_keeper/config.json');
  config.stateDir ||= path.join(os.homedir(), legacyConfig ? '.local/share/docs_keeper' : '.local/share/docs-keeper');
  return config;
}
export async function connect(config) {
  const db = await mysql.createConnection({ ...config.mysql, charset: 'utf8mb4', timezone: 'Z', dateStrings: true,
    supportBigNumbers: true, bigNumberStrings: true, multipleStatements: false, connectTimeout: 10000 });
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
async function atomicJson(file, object) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(object, null, 2), { mode: 0o600 });
  await fs.rename(temp, file);
}
async function readJob(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw new KeeperError('job_corrupt', '恢复记录无法解析，请先人工核对'); }
}
async function copyBody(config, file) {
  const root = await fs.realpath(config.lark.workspace);
  const absolute = await fs.realpath(path.resolve(config.lark.workspace, file));
  const relative = path.relative(root, absolute);
  assert(relative && !relative.startsWith('../') && !path.isAbsolute(relative), 'unsafe_copy_path', '副本正文文件必须位于工作区内');
  const stat = await fs.stat(absolute);
  assert(stat.isFile() && stat.size <= 8 * 1024 * 1024, 'invalid_copy_file', '副本正文必须是工作区内不超过8MiB的普通文件');
  const body = await fs.readFile(absolute, 'utf8');
  assert(body.trim(), 'empty_copy', '副本正文不能为空');
  return { relative, body };
}
async function prepareCopy(config, record, input, jobFile, prior, updating) {
  const body = input.copy_markdown_path ? await copyBody(config, input.copy_markdown_path) : null;
  let job = await readJob(jobFile);
  const digest = body ? contentDigest(body.body) : null;
  let url = record.copied_lark_link;
  let warnings = [];
  if (body) {
    if (job?.state === 'creating' && !url) throw new KeeperError('copy_result_uncertain', '先核对上次可能已创建的副本，并传 copied_lark_link 恢复', { job_file: jobFile });
    if (!url && job?.copy_url) url = job.copy_url;
    if (url && !updating && job?.body_digest && job.body_digest !== digest) {
      throw new KeeperError('copy_body_changed', '待恢复副本与新正文不同，请先核对已有副本', { copy_url: url });
    }
    const shouldUpdate = updating && prior?.copied_lark_link && (job?.body_digest !== digest || !job?.verified);
    if (!url || shouldUpdate) {
      await atomicJson(jobFile, { state: 'creating', copy_url: url, body_digest: digest, verified: false });
      const args = shouldUpdate
        ? ['docs', '+update', '--doc', url, '--command', 'overwrite', '--doc-format', 'markdown', '--content', '@./' + body.relative]
        : ['docs', '+create', '--title', record.title, '--doc-format', 'markdown', '--content', '@./' + body.relative];
      let data;
      try { data = await callLark(config.lark, args); }
      catch (e) {
        if (!e.details?.uncertain) await atomicJson(jobFile, { state: 'failed', copy_url: url, body_digest: digest, verified: false });
        throw e;
      }
      url = larkUrl(data.document?.url || url);
      assert(url, 'copy_result_uncertain', 'CLI成功但未返回副本地址，请核对后恢复');
      warnings = (data.warnings || []).map(w => typeof w === 'string' ? w : JSON.stringify(w));
      job = { state: 'copied', copy_url: url, body_digest: digest, warnings, verified: false };
      await atomicJson(jobFile, job);
    } else warnings = job?.warnings || [];
    const checked = await readCopy(config.lark, url, body.body);
    warnings.push(...checked.warnings);
    await atomicJson(jobFile, { state: 'verified', copy_url: url, body_digest: digest, warnings, verified: true, verification: checked.verification });
    if (warnings.length && input.accept_copy_warnings !== true) throw new KeeperError('copy_warnings', '副本有降级提示，核对后才可接受；重试会复用已有文档', { copy_url: url, warnings });
  } else if (url) await readCopy(config.lark, url);
  return { url, warnings };
}
export async function save(db, config, input, { updateId, confirmed = false } = {}) {
  assert(!updateId || confirmed, 'update_confirmation_required', '只有用户明确要求更新时才能使用 --confirmed');
  const [locked] = await db.execute("SELECT GET_LOCK('docs_keeper:useful_docs',30) AS acquired");
  assert(Number(locked[0].acquired) === 1, 'busy', '另一个收藏正在处理，请稍后重试');
  try {
    const prior = updateId ? await get(db, updateId) : null;
    const merged = prior ? { ...prior, source_created_at: prior.source_created_at ? prior.source_created_at.replace(' ', 'T') + 'Z' : null, ...input } : input;
    const normalized = normalizeRecord(merged, await types(db));
    const record = normalized.record;
    const duplicate = await find(db, record, updateId);
    if (duplicate.status === 'existing') return duplicate;
    if (duplicate.status === 'candidates' && !updateId && input.confirm_distinct !== true) return duplicate;
    const requiresFullText = !prior || ['abstract','link','copied_lark_link','copy_markdown_path'].some(k => Object.hasOwn(input, k));
    assert(!requiresFullText || input.full_text_confirmed === true, 'full_text_required', '新收藏或修改摘要/全文前必须获得并读完完整内容');
    const jobFile = path.join(config.stateDir, 'jobs', `${updateId ? 'update-' + updateId + '-' : ''}${jobKey(record)}.json`);
    let copyWarnings = [];
    if (!record.link && (record.copied_lark_link || input.copy_markdown_path)) {
      const copied = await prepareCopy(config, record, input, jobFile, prior, Boolean(updateId));
      record.copied_lark_link = copied.url;
      copyWarnings = copied.warnings;
    } else assert(!input.copy_markdown_path, 'unnecessary_copy', '有可访问原链接时不创建飞书副本');
    assert(record.link || record.copied_lark_link, 'missing_full_text', '缺少全文入口');
    const values = columns.map(k => record[k]);
    let id = updateId;
    if (prior) {
      await db.execute(`UPDATE useful_docs SET ${columns.map(k => k + '=?').join(',')},updated_at=UTC_TIMESTAMP(6) WHERE id=?`, [...values, String(updateId)]);
    } else {
      const [result] = await db.execute(`INSERT INTO useful_docs (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`, values);
      id = String(result.insertId);
    }
    await atomicJson(jobFile, { state: 'saved', record_id: String(id), copy_url: record.copied_lark_link,
      body_digest: input.copy_markdown_path ? contentDigest((await copyBody(config, input.copy_markdown_path)).body) : null,
      verified: true, warnings: copyWarnings });
    return { status: prior ? 'updated' : 'created', record: await get(db, id), warnings: [...normalized.warnings, ...copyWarnings] };
  } finally { await db.execute("SELECT RELEASE_LOCK('docs_keeper:useful_docs')"); }
}
async function inputJson(file) {
  assert(file, 'missing_input', '请指定JSON文件或 - 读取stdin');
  let content;
  if (file === '-') {
    content = ''; for await (const chunk of process.stdin) { content += chunk; assert(Buffer.byteLength(content) <= 8 * 1024 * 1024, 'input_too_large', 'JSON输入过大'); }
  } else content = await fs.readFile(file, 'utf8');
  try { const j = JSON.parse(content); assert(j && typeof j === 'object' && !Array.isArray(j), 'invalid_input', '需要JSON对象'); return j; }
  catch (e) { if (e instanceof KeeperError) throw e; throw new KeeperError('invalid_json', '输入不是有效JSON'); }
}
export async function main(argv = process.argv.slice(2)) {
  let configFile;
  const c = argv.indexOf('--config');
  if (c >= 0) { configFile = argv[c + 1]; argv.splice(c, 2); }
  const [command, ...args] = argv;
  if (command === '--version') {
    const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
    return { status: 'version', name: pkg.name, version: pkg.version };
  }
  if (!command || command === '--help') return { status: 'help', commands: ['doctor','types','check JSON|-','save JSON|-','get ID','search KEYWORD','update ID --confirmed JSON|-'] };
  const config = await readConfig(configFile);
  const db = await connect(config);
  try {
    if (command === 'doctor') {
      const [rows] = await db.query('SELECT DATABASE() AS db,CURRENT_USER() AS user,@@session.time_zone AS timezone');
      return { status: 'ready', database: rows[0].db, account: rows[0].user, timezone: rows[0].timezone, source_types: await types(db) };
    }
    if (command === 'types') return { status: 'types', values: await types(db) };
    if (command === 'get') return { status: 'found', record: await get(db, args[0]) };
    if (command === 'search') {
      assert(args[0]?.trim(), 'missing_query', '请输入标题关键词');
      const [rows] = await db.execute(`${select} WHERE LOCATE(?, title)>0 ORDER BY updated_at DESC,id DESC LIMIT 50`, [args.join(' ').trim()]);
      return { status: 'found', records: rows };
    }
    if (command === 'check') return await find(db, await inputJson(args[0]));
    if (command === 'save') return await save(db, config, await inputJson(args[0]));
    if (command === 'update') return await save(db, config, await inputJson(args.filter(a => a !== '--confirmed')[1]), { updateId: args[0], confirmed: args.includes('--confirmed') });
    throw new KeeperError('unknown_command', '未知命令，请使用 --help');
  } finally { await db.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(result => console.log(JSON.stringify({ ok: true, ...result }))).catch(e => {
    const known = e instanceof KeeperError;
    console.error(JSON.stringify({ ok: false, error: { code: known ? e.code : 'operation_failed',
      message: known ? e.message : '操作失败，请检查连接、表结构、配置文件及恢复记录；口令未输出', ...(known ? e.details : {}) } }));
    process.exitCode = 1;
  });
}

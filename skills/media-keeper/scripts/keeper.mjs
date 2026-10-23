#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assert, KeeperError } from '@media-keeper/core';
import { connect, types, get, find, searchByTitle } from '@media-keeper/db';
import { readConfig } from './config.mjs';
import { save } from './archive.mjs';
export { readConfig, save };
export { connect, types, get, find, columns } from '@media-keeper/db';

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
      const rows = await searchByTitle(db, args.join(' ').trim());
      return { status: 'found', records: rows };
    }
    if (command === 'check') return await find(db, await inputJson(args[0]));
    if (command === 'save') return await save(db, config, await inputJson(args[0]));
    if (command === 'update') return await save(db, config, await inputJson(args.filter(a => a !== '--confirmed')[1]), { updateId: args[0], confirmed: args.includes('--confirmed') });
    throw new KeeperError('unknown_command', '未知命令，请使用 --help');
  } finally { await db.end(); }
}
const invokedPath = process.argv[1] && await fs.realpath(path.resolve(process.argv[1])).catch(() => null);
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().then(result => console.log(JSON.stringify({ ok: true, ...result }))).catch(e => {
    const known = e instanceof KeeperError;
    console.error(JSON.stringify({ ok: false, error: { code: known ? e.code : 'operation_failed',
      message: known ? e.message : '操作失败，请检查连接、表结构、配置文件及恢复记录；口令未输出', ...(known ? e.details : {}) } }));
    process.exitCode = 1;
  });
}

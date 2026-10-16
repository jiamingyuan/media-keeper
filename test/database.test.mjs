import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readConfig, connect, save, get, find } from '../scripts/keeper.mjs';

test('real MySQL validates types, parameterization, deduplication, updates and constraints', { skip: process.env.DOCS_KEEPER_INTEGRATION !== '1' }, async () => {
  const config = await readConfig();
  config.stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docs-keeper-db-test-'));
  const db = await connect(config);
  const stamp = Date.now();
  const [before] = await db.query('SELECT COUNT(*) AS n FROM useful_docs');
  try {
    await db.beginTransaction();
    const records = [];
    for (const type of ['article','paper','blog','video','tech_doc','project_repo']) {
      const input = { title: `测试 ${stamp} ${type} O'Reilly'; DROP TABLE useful_docs; -- 😀`, source: 'docs-keeper 自动验收',
        source_type: type, author: ['甲','乙'], abstract: '正文的结论与限制。', link: `https://example.org/docs-keeper-test/${stamp}/${type}`,
        source_created_at: '2026-10-16T10:20:30.123456+08:00', full_text_confirmed: true };
      const result = await save(db, config, input);
      assert.equal(result.status, 'created'); assert.equal(result.record.source_type, type);
      assert.equal(result.record.author, '甲、乙'); assert.equal(result.record.source_created_at, '2026-10-16 02:20:30.123456');
      records.push(result.record);
      const duplicate = await save(db, config, { ...input, abstract: '不应覆盖的摘要', link: input.link + '?utm_source=test#anchor' });
      assert.equal(duplicate.status, 'existing');
      assert.equal((await get(db, result.record.id)).abstract, result.record.abstract);
      assert.equal((await get(db, result.record.id)).updated_at, result.record.updated_at);
    }
    const first = records[0];
    const candidates = await find(db, { title: first.title, source: first.source });
    assert.equal(candidates.status, 'candidates');
    await assert.rejects(() => save(db, config, { abstract: '新摘要。', full_text_confirmed: true }, { updateId: first.id }), e => e.code === 'update_confirmation_required');
    const updated = await save(db, config, { abstract: '重读后的新结论。', full_text_confirmed: true }, { updateId: first.id, confirmed: true });
    assert.equal(updated.status, 'updated'); assert.equal(updated.record.created_at, first.created_at);
    assert.equal(updated.record.source_created_at, first.source_created_at);
    assert.equal(updated.record.abstract, '重读后的新结论。'); assert.notEqual(updated.record.updated_at, first.updated_at);
    await assert.rejects(() => save(db, config, { title: `missing ${stamp}`, source_type: 'article', abstract: '结论', link: `https://example.org/missing/${stamp}` }), e => e.code === 'full_text_required');
    const sql = 'INSERT INTO useful_docs(title,abstract,source,source_type,link) VALUES (?,?,?,?,?)';
    await assert.rejects(() => db.execute(sql, ['invalid','摘要','验收','unknown','https://example.org/invalid']));
    await assert.rejects(() => db.execute(sql, ['invalid','长'.repeat(401),'验收','article','https://example.org/invalid']));
    await assert.rejects(() => db.execute(sql, ['invalid','摘要','验收','article',null]));
    await db.rollback();
    const [after] = await db.query('SELECT COUNT(*) AS n FROM useful_docs');
    assert.equal(after[0].n, before[0].n);
  } finally {
    await db.rollback(); await db.end(); await fs.rm(config.stateDir, { recursive: true, force: true });
  }
});

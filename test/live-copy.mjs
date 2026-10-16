// Explicit live acceptance test; creates one clearly labelled sample document.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readConfig, connect, find, save, get } from '../scripts/keeper.mjs';
import { jobKey } from '../scripts/lib.mjs';
import { readCopy } from '../scripts/lark.mjs';

assert.ok(process.argv.includes('--live'), 'Use --live to create a labelled acceptance sample');
const config = await readConfig();
const db = await connect(config);
try {
  const input = {
    title: 'docs-keeper 验收样文：全文、格式与失败恢复', source: 'docs-keeper 验收样本', source_type: 'article',
    author: 'docs-keeper 测试作者', source_created_at: '2026-10-16', link: null,
    abstract: '自制验收样文包含表格、代码和图片：检查值为42。收藏应先核对全文、保留原文结构；重复记录不覆盖，副本已创建而入库失败时应复用原副本。该样本仅用于测试，不能推断真实网站的抓取成功率。',
    copy_markdown_path: 'docs-keeper-validation/fulltext.md', full_text_confirmed: true
  };
  const previous = await find(db, input);
  if (previous.records.length) {
    console.log(JSON.stringify({ status: 'already_tested', record: previous.records[0] }));
  } else {
    let injected = false;
    const flaky = new Proxy(db, { get(target, prop) {
      if (prop === 'execute') return async (sql, params) => {
        if (!injected && /^INSERT INTO useful_docs/.test(sql)) { injected = true; throw new Error('SIMULATED_DATABASE_FAILURE_AFTER_COPY'); }
        return target.execute(sql, params);
      };
      const value = Reflect.get(target, prop); return typeof value === 'function' ? value.bind(target) : value;
    } });
    await assert.rejects(() => save(flaky, config, input), /SIMULATED_DATABASE_FAILURE_AFTER_COPY/);
    assert.equal((await find(db, input)).status, 'new');
    const job = JSON.parse(await fs.readFile(path.join(config.stateDir, 'jobs', jobKey(input) + '.json'), 'utf8'));
    assert.equal(job.verified, true); assert.ok(job.copy_url);
    const saved = await save(db, config, input);
    assert.equal(saved.status, 'created'); assert.equal(saved.record.copied_lark_link, job.copy_url);
    const duplicate = await save(db, config, { ...input, copied_lark_link: job.copy_url });
    assert.equal(duplicate.status, 'existing');
    assert.equal((await get(db, saved.record.id)).updated_at, saved.record.updated_at);
    const expected = await fs.readFile(path.join(config.lark.workspace, input.copy_markdown_path), 'utf8');
    const verified = await readCopy(config.lark, job.copy_url, expected);
    console.log(JSON.stringify({ status: 'passed', checks: ['full_text_readback','image_retained','database_failure_recovery','copy_reused','duplicate_unchanged'],
      record: saved.record, verification: verified.verification }));
  }
} finally { await db.end(); }

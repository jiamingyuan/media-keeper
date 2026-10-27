import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractPage } from '../scripts/fetch.mjs';
import { isLootDropReportUrl } from '../scripts/loot-drop.mjs';
import { save } from '../scripts/archive.mjs';
import { columns } from '@media-keeper/db';

const original = 'https://www.loot-drop.io/startup/123-sample';
const copy = 'https://example.feishu.cn/docx/sample';
const sectionNames = ['Failure Analysis', 'Market Analysis', 'Startup Learnings', 'Market Potential', 'Difficulty', 'Scalability'];
const fixture = () => `<html><head><title>Sample report</title><script type="application/ld+json">{"@type":"Article","datePublished":"2026-10-20"}</script></head><body><main>
<section><h1><span id="startup-name">Sample</span><span>Country</span></h1><p class="hero-story">Complete company introduction.</p><div class="stats-bar"><div class="stat-box"><span class="stat-label">SECTOR</span><span class="stat-value">Consumer</span></div></div></section>
<div class="shutdown-grid">${sectionNames.map((name, i) => `<article class="grid-card" data-full-text="Full section ${i} &amp; final qualification ${i}."><h3 class="card-title">${name}</h3><p>Short preview...</p></article>`).join('')}</div>
<section class="master-timeline-section"><h2>Rebuild</h2><div class="master-stage-body"><h3>Execution Plan</h3><p style="display:none">Hidden phase goal, budget and closing condition.</p><div class="tech-tags"><span class="tech-tag">Tool A</span><span class="tech-tag">Tool B</span></div></div></section>
<section class="related-section"><h2>Related Startup Failures</h2><article data-href="/startup/456-related"><h3 class="card-v2-name">Related Company</h3></article></section></main></body></html>`;

test('Loot Drop extractor reads every complete modal, hidden plan, overview table and related link', () => {
  const result = extractPage(fixture(), original);
  for (let i = 0; i < 6; i++) assert.ok(result.markdown.includes(`Full section ${i} & final qualification ${i}.`));
  assert.doesNotMatch(result.markdown, /Short preview/);
  assert.match(result.markdown, /Hidden phase goal, budget and closing condition/);
  assert.match(result.markdown, /\| SECTOR \| Consumer \|/);
  assert.match(result.markdown, /Related Company\]\(https:\/\/www\.loot-drop\.io\/startup\/456-related\)/);
  assert.match(result.markdown, /-\s+Tool A/);
  assert.equal(result.metadata.title, 'Sample');
  assert.equal(result.metadata.source, 'Loot Drop');
  assert.equal(result.metadata.source_created_at, '2026-10-20');
  assert.equal(result.metadata.full_text_confirmed, false);
  assert.equal(result.metadata.loot_drop_sections.length, 6);
  const incomplete = fixture().replace('data-full-text="Full section 3 &amp; final qualification 3."', '');
  assert.throws(() => extractPage(incomplete, original), e => e.code === 'loot_drop_incomplete');
});

test('source detection excludes lookalike domains and unrelated Loot Drop pages', () => {
  for (const address of [original, original.replace('www.', ''), original + '/?utm_source=test']) assert.equal(isLootDropReportUrl(address), true);
  for (const address of ['https://loot-drop.io.example.org/startup/1', 'https://example.org/loot-drop.io/startup/1', 'https://www.loot-drop.io/insights', 'file:///startup/1', null]) assert.equal(isLootDropReportUrl(address), false);
});

async function setup(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'media-keeper-loot-test-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const workspace = path.join(temp, 'workspace');
  const drafts = path.join(temp, 'drafts');
  await fs.mkdir(workspace); await fs.mkdir(drafts);
  const body = '# 中文完整转载\n\n完整公司介绍与原文入口。\n\n| 类别 | 内容 |\n| --- | --- |\n| 领域 | 消费 |\n\n# 分析\n\n关键结论及其限制。\n\n1. 完整方案\n2. 预算与条件\n';
  const draft = path.join(drafts, 'zh.md');
  await fs.writeFile(draft, body);
  const bin = path.join(temp, 'fake-lark');
  // Local CLI fixture only; never contacts Feishu or uses credentials.
  await fs.writeFile(bin, `#!/usr/bin/env node
const fs = require('node:fs'); const path = require('node:path');
const root = __dirname, args = process.argv.slice(2), kind = args.find(x => ['+create', '+update', '+fetch'].includes(x));
fs.appendFileSync(path.join(root, 'calls'), JSON.stringify({kind,cwd:process.cwd(),title:args.includes('--title') ? args[args.indexOf('--title')+1] : null})+'\\n');
if (kind === '+create' || kind === '+update') {
  const content = args[args.indexOf('--content')+1];
  fs.writeFileSync(path.join(root,'body'),fs.readFileSync(path.resolve(process.cwd(),content.slice(1))));
  console.log(JSON.stringify({ok:true,data:{document:{url:${JSON.stringify(copy)}}}}));
} else { const text = fs.existsSync(path.join(root,'truncate')) ? '不完整正文' : fs.readFileSync(path.join(root,'body'),'utf8');
  console.log(JSON.stringify({ok:true,data:{document:{content:text}}})); }
`, { mode: 0o700 });
  const writes = [], records = new Map(); let failInsert = false;
  const db = {
    async query(sql) { assert.match(sql, /^SHOW COLUMNS/); return [[{ Type: "enum('article','paper','podcast','video','tech_doc','project_repo')" }]]; },
    async execute(sql, params) {
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
      if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
      if (sql.includes('BINARY link')) return [[...records.values()].filter(r => params.filter(Boolean).some(p => p === r.link || p === r.copied_lark_link))];
      if (sql.includes('WHERE title=?')) return [[...records.values()].filter(r => r.title === params[0] && r.source === params[1])];
      if (sql.includes('WHERE id=?') && sql.startsWith('SELECT')) return [[records.get(params[0])].filter(Boolean)];
      if (sql.startsWith('INSERT')) {
        if (failInsert) { failInsert = false; throw new Error('simulated database failure'); }
        const record = { id: String(records.size + 1), ...Object.fromEntries(columns.map((k,i) => [k, params[i]])), created_at:'2026-10-27 00:00:00', updated_at:'2026-10-27 00:00:00' };
        records.set(record.id, record); writes.push(record); return [{ insertId: record.id }];
      }
      if (sql.startsWith('UPDATE')) {
        const id = params.at(-1); records.set(id, { ...records.get(id), ...Object.fromEntries(columns.map((k,i) => [k, params[i]])) });
        writes.push(records.get(id)); return [{}];
      }
      throw new Error('Unexpected SQL: ' + sql);
    }
  };
  const config = { lark: { bin, workspace, profile:'local-test' }, stateDir:path.join(temp,'state') };
  const input = { title:'示例公司 Loot Drop 分析', abstract:'公司以配送为主业；报告分析了资金消耗与失败原因，并提出重建设想。', source:'Loot Drop', source_type:'article', link:original,
    copy_markdown_path:draft, full_text_confirmed:true };
  const calls = async () => (await fs.readFile(path.join(temp,'calls'),'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(x => JSON.parse(x));
  return { temp, db, config, input, body, calls, writes, records, failNextInsert:() => { failInsert = true; } };
}

test('dual links persist after readback, temp draft stays outside workspace and duplicate creates nothing', async t => {
  const s = await setup(t);
  const result = await save(s.db, s.config, s.input);
  assert.equal(result.status, 'created');
  assert.equal(result.record.title, s.input.title);
  assert.equal(result.record.link, original); assert.equal(result.record.copied_lark_link, copy);
  const created = (await s.calls()).filter(c => c.kind === '+create');
  assert.equal(created.length, 1); assert.equal(created[0].title, s.input.title); assert.equal(created[0].cwd, await fs.realpath(path.dirname(s.input.copy_markdown_path)));
  assert.deepEqual(await fs.readdir(s.config.lark.workspace), []);
  const duplicate = await save(s.db, s.config, s.input);
  assert.equal(duplicate.status, 'existing'); assert.equal(s.writes.length, 1);
  assert.equal((await s.calls()).filter(c => c.kind === '+create').length, 1);
  // An abstract-only update keeps the existing copy and never rewrites its body.
  const updated = await save(s.db, s.config, { abstract:'重读后的摘要。', full_text_confirmed:true }, { updateId:result.record.id, confirmed:true });
  assert.equal(updated.record.copied_lark_link, copy);
  assert.equal((await s.calls()).filter(c => c.kind === '+update').length, 0);
});

test('readback failure blocks insertion and recovery reuses the created document', async t => {
  const s = await setup(t);
  await fs.writeFile(path.join(s.temp,'truncate'), '');
  await assert.rejects(save(s.db,s.config,s.input), e => e.code === 'copy_verification_failed');
  assert.equal(s.writes.length,0);
  await fs.unlink(path.join(s.temp,'truncate'));
  const result = await save(s.db,s.config,s.input);
  assert.equal(result.record.copied_lark_link,copy);
  assert.equal((await s.calls()).filter(c => c.kind === '+create').length,1);
});

test('database failure after readback reuses one copy on retry', async t => {
  const s = await setup(t); s.failNextInsert();
  await assert.rejects(save(s.db,s.config,s.input), /simulated database failure/);
  assert.equal(s.writes.length,0);
  await fs.writeFile(s.input.copy_markdown_path, s.body + '\n新正文不能悄悄替换恢复副本。');
  await assert.rejects(save(s.db,s.config,s.input), e => e.code === 'copy_body_changed');
  await fs.writeFile(s.input.copy_markdown_path, s.body);
  const result = await save(s.db,s.config,s.input);
  assert.equal(result.record.link,original); assert.equal(result.record.copied_lark_link,copy);
  assert.equal((await s.calls()).filter(c => c.kind === '+create').length,1);
});

test('verified existing copy is read even when original link is present', async t => {
  const s = await setup(t); await fs.writeFile(path.join(s.temp,'body'),s.body);
  const { copy_markdown_path, ...input } = s.input;
  const result = await save(s.db,s.config,{ ...input, copied_lark_link:copy });
  assert.equal(result.record.link,original); assert.equal(result.record.copied_lark_link,copy);
  assert.deepEqual((await s.calls()).map(c => c.kind),['+fetch']);
});

test('report requires both links, normal sources retain copy policy, unsafe draft links are rejected', async t => {
  const s = await setup(t);
  const { copy_markdown_path, ...input } = s.input;
  await assert.rejects(save(s.db,s.config,input), e => e.code === 'loot_drop_copy_required');
  await assert.rejects(save(s.db,s.config,{ ...input, link:null, copied_lark_link:copy }), e => e.code === 'loot_drop_original_required');
  await assert.rejects(save(s.db,s.config,{ ...s.input,source:'Example',link:'https://example.org/article' }), e => e.code === 'unnecessary_copy');
  const escaped = path.join(path.dirname(s.input.copy_markdown_path),'escape.md');
  await fs.symlink(fileURLToPath(new URL('../../../README.md',import.meta.url)),escaped);
  await assert.rejects(save(s.db,s.config,{ ...s.input,copy_markdown_path:escaped }), e => e.code === 'unsafe_copy_path');
  assert.equal(s.writes.length,0); assert.deepEqual(await s.calls(),[]);
});

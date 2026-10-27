import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { isLootDropReportUrl } from './loot-drop.mjs';
import { assert, KeeperError, larkUrl, normalizeRecord, jobKey, contentDigest } from '@media-keeper/core';
import { get, find, types, acquireWriteLock, releaseWriteLock, writeRecord } from '@media-keeper/db';
import { callLark, readCopy } from './lark.mjs';

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
  const within = (parent, child) => {
    const relative = path.relative(parent, child);
    return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
  };
  const temporaryRoots = await Promise.all([os.tmpdir(), '/tmp'].map(p => fs.realpath(p)));
  const inWorkspace = within(root, absolute);
  assert(inWorkspace || temporaryRoots.some(p => within(p, absolute)), 'unsafe_copy_path',
    '副本正文文件必须位于配置工作区或系统临时目录内');
  // Keep temporary drafts out of the project; relative images resolve beside the draft.
  const workspace = inWorkspace ? root : path.dirname(absolute);
  const relative = path.relative(workspace, absolute);
  const stat = await fs.stat(absolute);
  assert(stat.isFile() && stat.size <= 8 * 1024 * 1024, 'invalid_copy_file', '副本正文必须是不超过8MiB的普通文件');
  const body = await fs.readFile(absolute, 'utf8');
  assert(body.trim(), 'empty_copy', '副本正文不能为空');
  return { relative, body, workspace };
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
      try { data = await callLark({ ...config.lark, workspace: body.workspace }, args); }
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
  await acquireWriteLock(db);
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
    const lootDrop = isLootDropReportUrl(record.link) || /^loot[ -]drop$/i.test(record.source);
    assert(!lootDrop || isLootDropReportUrl(record.link), 'loot_drop_original_required', 'Loot Drop 报告必须保留原文链接');
    assert(!lootDrop || record.copied_lark_link || input.copy_markdown_path, 'loot_drop_copy_required',
      'Loot Drop 报告需要已核对的中文飞书分析文档，不能只保存原文或短摘要');
    assert(!input.copy_markdown_path || !record.link || lootDrop, 'unnecessary_copy', '有可访问原链接时不创建飞书副本（Loot Drop 报告除外）');
    const jobFile = path.join(config.stateDir, 'jobs', `${updateId ? 'update-' + updateId + '-' : ''}${jobKey(record)}.json`);
    let copyWarnings = [];
    if (record.copied_lark_link || input.copy_markdown_path) {
      const copied = await prepareCopy(config, record, input, jobFile, prior, Boolean(updateId));
      record.copied_lark_link = copied.url;
      copyWarnings = copied.warnings;
    }
    assert(record.link || record.copied_lark_link, 'missing_full_text', '缺少全文入口');
    const id = await writeRecord(db, record, updateId);
    await atomicJson(jobFile, { state: 'saved', record_id: String(id), copy_url: record.copied_lark_link,
      body_digest: input.copy_markdown_path ? contentDigest((await copyBody(config, input.copy_markdown_path)).body) : null,
      verified: true, warnings: copyWarnings });
    return { status: prior ? 'updated' : 'created', record: await get(db, id), warnings: [...normalized.warnings, ...copyWarnings] };
  } finally { await releaseWriteLock(db); }
}

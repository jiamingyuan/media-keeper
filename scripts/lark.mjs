import { spawn } from 'node:child_process';
import { KeeperError, verifyCopy } from './lib.mjs';

export function callLark(config, args, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(config.bin || 'lark-cli', ['--profile', config.profile, ...args, '--as', 'user'], {
      cwd: config.workspace, env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '', stderr = '', overflow = false, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeout);
    const collect = stream => data => {
      if (stream === 'out') stdout += data; else stderr += data;
      if (stdout.length + stderr.length > 16 * 1024 * 1024) { overflow = true; child.kill('SIGTERM'); }
    };
    child.stdout.setEncoding('utf8').on('data', collect('out'));
    child.stderr.setEncoding('utf8').on('data', collect('err'));
    child.on('error', () => { clearTimeout(timer); reject(new KeeperError('lark_unavailable', '无法启动配置的 lark-cli')); });
    child.on('close', code => {
      clearTimeout(timer);
      let j;
      try { j = JSON.parse(code === 0 ? stdout : stderr); } catch { /* no raw output: it may contain private data */ }
      if (timedOut || overflow || !j) return reject(new KeeperError('lark_result_uncertain', 'CLI结果不确定，请先核对实际文档，勿重复创建', { uncertain: true }));
      if (code !== 0 || j.ok !== true) return reject(new KeeperError('lark_failed', '飞书CLI调用失败，请按官方CLI检查登录态或权限', {
        api_code: j.error?.code, api_type: j.error?.type, missing_scopes: j.error?.missing_scopes
      }));
      resolve(j.data);
    });
  });
}

export async function readCopy(config, url, expected) {
  const data = await callLark(config, ['docs', '+fetch', '--doc', url, '--doc-format', 'markdown']);
  const content = data.document?.content;
  if (typeof content !== 'string' || !content.trim()) throw new KeeperError('copy_verification_failed', '飞书副本回读为空', { copy_url: url });
  const verification = expected == null ? { accessible: true } : verifyCopy(expected, content);
  if (expected != null && !verification.text_complete) throw new KeeperError('copy_verification_failed', '副本正文回读未覆盖全部原文，请核对后修复', { copy_url: url, verification });
  return { verification, warnings: expected != null && !verification.images_complete ? ['副本图片数量少于原文，请核对图片缺失'] : [] };
}

import { main as keeper } from '../skills/media-keeper/scripts/keeper.mjs';
import { main as fetchPage } from '../skills/media-keeper/scripts/fetch.mjs';
import { KeeperError } from '@media-keeper/core';
import { fileURLToPath } from 'node:url';
process.env.MEDIA_KEEPER_CONFIG ||= process.env.DOCS_KEEPER_CONFIG || fileURLToPath(new URL('../runtime/config.local.json', import.meta.url));
const args = process.argv.slice(2);
try {
  const result = args[0] === 'fetch' ? await fetchPage(args.slice(1)) : { ok: true, ...await keeper(args) };
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: { code: error.code || 'operation_failed', message: error instanceof KeeperError ? error.message : '操作失败，请检查配置、连接及输入', ...(error.details || {}) } }));
  process.exitCode = 1;
}

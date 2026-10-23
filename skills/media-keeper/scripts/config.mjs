import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assert } from '@media-keeper/core';
import { readDatabaseConfig } from '@media-keeper/db';

export async function readConfig(file = process.env.MEDIA_KEEPER_CONFIG || process.env.DOCS_KEEPER_CONFIG) {
  if (!file) {
    for (const name of ['media-keeper', 'docs-keeper', 'docs_keeper']) {
      file = path.join(os.homedir(), '.config', name, 'config.json');
      try { await fs.access(file); break; }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
  }
  const config = await readDatabaseConfig(file);
  assert(config.lark?.profile && path.isAbsolute(config.lark.workspace), 'invalid_config', '缺少飞书 profile 或绝对工作区路径');
  const legacyName = ['docs-keeper', 'docs_keeper'].find(name =>
    path.resolve(file) === path.join(os.homedir(), '.config', name, 'config.json'));
  config.stateDir ||= path.join(os.homedir(), '.local/share', legacyName || 'media-keeper');
  return config;
}

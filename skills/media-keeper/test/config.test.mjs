import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readConfig } from '../scripts/keeper.mjs';

test('renamed configuration prefers media-keeper and preserves legacy recovery directories', async t => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'media-keeper-config-'));
  t.mock.method(os, 'homedir', () => tempRoot);
  const saved = Object.fromEntries(['MEDIA_KEEPER_CONFIG', 'DOCS_KEEPER_CONFIG'].map(k => [k, process.env[k]]));
  for (const k of Object.keys(saved)) delete process.env[k];
  t.after(async () => {
    for (const [k, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[k]; else process.env[k] = value;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  });
  const files = {};
  for (const name of ['media-keeper', 'docs-keeper', 'docs_keeper']) {
    const file = path.join(tempRoot, '.config', name, 'config.json');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({
      mysql: { database: 'agent', user: 'test_account', password: 'test-placeholder' },
      lark: { profile: 'test-profile', workspace: tempRoot },
      marker: name,
    }), { mode: 0o600 });
    files[name] = file;
  }
  const current = await readConfig();
  assert.equal(current.marker, 'media-keeper');
  assert.equal(current.stateDir, path.join(tempRoot, '.local/share/media-keeper'));
  process.env.DOCS_KEEPER_CONFIG = files.docs_keeper;
  assert.equal((await readConfig()).marker, 'docs_keeper');
  process.env.MEDIA_KEEPER_CONFIG = files['media-keeper'];
  assert.equal((await readConfig()).marker, 'media-keeper');
  assert.equal((await readConfig(files['docs-keeper'])).marker, 'docs-keeper');
  for (const k of Object.keys(saved)) delete process.env[k];
  await fs.unlink(files['media-keeper']);
  const legacy = await readConfig();
  assert.equal(legacy.marker, 'docs-keeper');
  assert.equal(legacy.stateDir, path.join(tempRoot, '.local/share/docs-keeper'));
  await fs.unlink(files['docs-keeper']);
  const oldest = await readConfig();
  assert.equal(oldest.marker, 'docs_keeper');
  assert.equal(oldest.stateDir, path.join(tempRoot, '.local/share/docs_keeper'));
  await fs.chmod(files.docs_keeper, 0o644);
  await assert.rejects(readConfig(), e => e.code === 'config_permissions');
});

test('legacy script symlinks still execute the renamed command', async t => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'media-keeper-alias-'));
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  const alias = path.join(tempRoot, 'keeper.mjs');
  await fs.symlink(fileURLToPath(new URL('../scripts/keeper.mjs', import.meta.url)), alias);
  const result = spawnSync(process.execPath, [alias, '--version'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).name, 'media-keeper');
});

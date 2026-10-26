import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../', import.meta.url));
const defaultOutput = path.join(root, 'dist/media-keeper');
const output = path.resolve(process.argv[2] || defaultOutput);
if (output !== defaultOutput) {
  try { await fs.access(output); throw new Error('自定义输出目录必须尚不存在'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
} else { await fs.rm(output, { recursive: true, force: true }); }
const skill = JSON.parse(await fs.readFile(path.join(root, 'skills/media-keeper/package.json'), 'utf8'));
const core = JSON.parse(await fs.readFile(path.join(root, 'packages/core/package.json'), 'utf8'));
const db = JSON.parse(await fs.readFile(path.join(root, 'packages/db/package.json'), 'utf8'));
const dependencies = Object.fromEntries(Object.entries({ ...skill.dependencies, ...core.dependencies, ...db.dependencies }).filter(([name]) => !name.startsWith('@media-keeper/')));
await fs.mkdir(output, { recursive: true });
await build({ entryPoints: ['keeper', 'fetch'].map(name => path.join(root, `skills/media-keeper/scripts/${name}.mjs`)),
  outdir: path.join(output, 'scripts'), outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node',
  format: 'esm', target: 'node20', external: Object.keys(dependencies) });
for (const name of ['bilibili.py', 'audio-requirements.txt']) {
  await fs.copyFile(path.join(root, 'skills/media-keeper/scripts', name), path.join(output, 'scripts', name));
}
await fs.cp(path.join(root, 'skills/media-keeper/SKILL.md'), path.join(output, 'SKILL.md'));
await fs.cp(path.join(root, 'skills/media-keeper/references'), path.join(output, 'references'), { recursive: true });
await fs.copyFile(path.join(root, 'deploy/skill.config.example.json'), path.join(output, 'config.example.json'));
await fs.writeFile(path.join(output, 'package.json'), JSON.stringify({ name: 'media-keeper', version: skill.version, private: true,
  type: 'module', engines: { node: '>=20' }, dependencies }, null, 2) + '\n');
console.log(JSON.stringify({ output, install: 'npm install --ignore-scripts', bundled: ['skill', 'core', 'db'] }));

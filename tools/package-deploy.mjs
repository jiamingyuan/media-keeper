import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const image = 'node-nginx:24.20.0-1.31-trixie';
const manifests = ['', 'apps/api', 'apps/web', 'packages/core', 'packages/db', 'skills/media-keeper'];
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}
async function copy(source, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(source, destination, { recursive: true, verbatimSymlinks: true });
}
async function verifyLinks(directory, artifact) {
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const location = path.join(directory, item.name);
    if (item.isSymbolicLink()) {
      const target = await fs.realpath(location);
      if (!target.startsWith(artifact + path.sep)) throw new Error('Production dependency links outside deployment artifact');
    } else if (item.isDirectory()) await verifyLinks(location, artifact);
  }
}

let temporary, release, nextLink;
let complete = false;
try {
  await run('docker', ['image', 'inspect', image, '--format', '{{.Id}}']);
  await run('npm', ['run', 'build:api']);
  await run('npm', ['run', 'build:web']);
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'media-keeper-package-'));
  const install = path.join(temporary, 'install');
  const artifact = path.join(temporary, 'app');
  await fs.mkdir(artifact, { recursive: true, mode: 0o755 });
  for (const workspace of manifests) {
    const relative = path.join(workspace, 'package.json');
    await copy(path.join(root, relative), path.join(install, relative));
  }
  await copy(path.join(root, 'package-lock.json'), path.join(install, 'package-lock.json'));
  await run('docker', ['run', '--rm', '--pull=never', '--entrypoint', '/bin/sh',
    '--user', `${process.getuid()}:${process.getgid()}`, '--env', 'HOME=/tmp', '--env', 'NPM_CONFIG_CACHE=/tmp/npm-cache',
    '--mount', `type=bind,source=${install},target=/build`, '--workdir', '/build', image,
    '-c', 'npm ci --omit=dev --workspace=@media-keeper/api --ignore-scripts --no-audit --no-fund']);
  for (const workspace of ['', 'apps/api', 'apps/web', 'packages/core', 'packages/db']) {
    await copy(path.join(root, workspace, 'package.json'), path.join(artifact, workspace, 'package.json'));
  }
  for (const relative of ['apps/api/dist', 'apps/web/dist']) await copy(path.join(root, relative), path.join(artifact, relative));
  for (const workspace of ['core', 'db']) {
    for (const file of ['index.mjs', 'index.d.mts']) {
      const relative = `packages/${workspace}/${file}`;
      await copy(path.join(root, relative), path.join(artifact, relative));
    }
  }
  for (const file of ['nginx.conf', 'container-entrypoint.sh']) {
    await copy(path.join(root, 'deploy', file), path.join(artifact, 'deploy', file));
  }
  await copy(path.join(install, 'node_modules'), path.join(artifact, 'node_modules'));
  await verifyLinks(path.join(artifact, 'node_modules'), await fs.realpath(artifact));
  await fs.writeFile(path.join(artifact, 'release.json'), JSON.stringify({ version: pkg.version, runtime_image: image }, null, 2) + '\n');
  const deployment = path.join(root, 'runtime/deploy');
  release = path.join(deployment, 'releases', `${pkg.version}-${Date.now()}`);
  await copy(artifact, release);
  await fs.chmod(release, 0o755);
  const current = path.join(deployment, 'current');
  const previous = await fs.lstat(current).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (previous && !previous.isSymbolicLink()) throw new Error('runtime/deploy/current must be a symlink; existing files were preserved');
  nextLink = path.join(deployment, `.current-${process.pid}`);
  await fs.symlink(path.relative(deployment, release), nextLink);
  await fs.rename(nextLink, current);
  complete = true;
  console.log(JSON.stringify({ version: pkg.version, image, release_directory: release, current,
    deploy: 'npm run deploy' }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (nextLink) await fs.rm(nextLink, { force: true });
  if (temporary) await fs.rm(temporary, { recursive: true, force: true });
  if (release && !complete) await fs.rm(release, { recursive: true, force: true });
}

import { fileURLToPath } from 'node:url';
import { readDatabaseConfig } from '@media-keeper/db';
export async function readApiConfig() {
  const file = process.env.MEDIA_KEEPER_API_CONFIG || fileURLToPath(new URL('../../../runtime/api.local.json', import.meta.url));
  const config = await readDatabaseConfig(file);
  const port = config.server?.port ?? 3001;
  const host = config.server?.host ?? '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535 || typeof host !== 'string' || !host.trim()) {
    throw new Error('Invalid API server configuration');
  }
  return { ...config, server: { host, port } };
}

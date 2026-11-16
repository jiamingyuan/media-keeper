import { fileURLToPath } from 'node:url';
import { readDatabaseConfig } from '@media-keeper/db';
import { readAcometConfig } from './acomet.js';
export async function readApiConfig() {
  const file = process.env.MEDIA_KEEPER_API_CONFIG || fileURLToPath(new URL('../../../runtime/api.local.json', import.meta.url));
  const config = await readDatabaseConfig(file);
  const override = process.env.MEDIA_KEEPER_API_PORT;
  if (override !== undefined && !/^\d+$/.test(override)) throw new Error('Invalid API port');
  const port = override === undefined ? config.server?.port ?? 3001 : Number(override);
  const host = config.server?.host ?? '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535 || typeof host !== 'string' || !host.trim()) {
    throw new Error('Invalid API server configuration');
  }
  if (readAcometConfig() && !['127.0.0.1', '::1'].includes(host)) throw new Error('Acomet API must listen on loopback');
  return { ...config, server: { host, port } };
}

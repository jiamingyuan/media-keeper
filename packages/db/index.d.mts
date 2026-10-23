import type { Connection, Pool, ConnectionOptions } from 'mysql2/promise';
import type { MediaRecord, MediaFilters } from '@media-keeper/core';
export interface DatabaseConfig { mysql: ConnectionOptions; server?: { host?: string; port?: number }; }
export interface MediaPage { data: MediaRecord[]; source_type_counts: Record<MediaRecord['source_type'], number>; pagination: { page: number; page_size: number; total: number; total_pages: number }; }
export function readDatabaseConfig(file: string): Promise<DatabaseConfig>;
export function connectionOptions(config: DatabaseConfig): ConnectionOptions;
export function createDatabasePool(config: DatabaseConfig): Pool;
export function connect(config: DatabaseConfig): Promise<Connection>;
export function types(db: Connection): Promise<string[]>;
export function get(db: Connection, id: string): Promise<MediaRecord>;
export function listMedia(db: Connection, filters: MediaFilters): Promise<MediaPage>;

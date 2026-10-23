import { Injectable, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { createDatabasePool, types } from '@media-keeper/db';
import { SOURCE_TYPES } from '@media-keeper/core';
import type { Connection, Pool } from 'mysql2/promise';
import { readApiConfig } from './config.js';
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool?: Pool;
  async onModuleInit() {
    this.pool = createDatabasePool(await readApiConfig());
    try {
      const values = await this.read(db => types(db));
      if (SOURCE_TYPES.some(type => !values.includes(type))) throw new Error('Incompatible database schema');
    } catch (error) {
      await this.pool.end();
      this.pool = undefined;
      throw error;
    }
  }
  async read<T>(task: (db: Connection) => Promise<T>): Promise<T> {
    if (!this.pool) throw new Error('Database unavailable');
    const db = await this.pool.getConnection();
    try {
      await db.query("SET time_zone = '+00:00'");
      await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await db.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
      const result = await task(db);
      await db.commit();
      return result;
    } catch (error) {
      await db.rollback();
      throw error;
    } finally { db.release(); }
  }
  async onModuleDestroy() { await this.pool?.end(); }
}

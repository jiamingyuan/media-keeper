import { Injectable } from '@nestjs/common';
import { get, listMedia } from '@media-keeper/db';
import { serializeMediaRecord, type MediaFilters } from '@media-keeper/core';
import { DatabaseService } from './database.service.js';
@Injectable()
export class MediaService {
  constructor(private readonly database: DatabaseService) {}
  async list(filters: MediaFilters) {
    return this.database.read(async db => {
      const page = await listMedia(db, filters);
      return { ...page, data: page.data.map(serializeMediaRecord) };
    });
  }
  async detail(id: string) {
    return this.database.read(async db => ({ data: serializeMediaRecord(await get(db, id)) }));
  }
  async health() {
    return this.database.read(async db => { await db.query('SELECT 1'); return { status: 'ok' }; });
  }
}

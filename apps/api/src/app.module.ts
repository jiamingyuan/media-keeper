import { Module } from '@nestjs/common';
import { DatabaseService } from './database.service.js';
import { MediaService } from './media.service.js';
import { MediaController } from './media.controller.js';
@Module({ controllers: [MediaController], providers: [DatabaseService, MediaService] })
export class AppModule {}

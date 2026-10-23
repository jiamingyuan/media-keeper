import { BadRequestException, Controller, Get, Injectable, Param, Query, type PipeTransform } from '@nestjs/common';
import { SOURCE_TYPES, parseMediaQuery, type MediaFilters } from '@media-keeper/core';
import { MediaService } from './media.service.js';
@Injectable()
export class MediaQueryPipe implements PipeTransform {
  transform(value: unknown) { return parseMediaQuery(value); }
}
@Controller()
export class MediaController {
  constructor(private readonly media: MediaService) {}
  @Get('health') health() { return this.media.health(); }
  @Get('media/types') types() { return { data: SOURCE_TYPES }; }
  @Get('media') list(@Query(new MediaQueryPipe()) filters: MediaFilters) { return this.media.list(filters); }
  @Get('media/:id') detail(@Param('id') id: string) {
    if (!/^[1-9]\d*$/.test(id) || id.length > 20 || BigInt(id) > 18446744073709551615n) {
      throw new BadRequestException('id 必须是有效的正整数');
    }
    return this.media.detail(id);
  }
}

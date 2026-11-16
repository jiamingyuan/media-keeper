// Deterministic HTTP fixture: real NestJS + JWT/CORS, no database access.
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { pairwiseSubject } from '@acomet/server-sdk/issuer';
import { SOURCE_TYPES, KeeperError } from '@media-keeper/core';
import { AppModule } from '../apps/api/dist/app.module.js';
import { MediaService } from '../apps/api/dist/media.service.js';
import { DatabaseService } from '../apps/api/dist/database.service.js';
import { configureApi } from '../apps/api/dist/application.js';
const records=Array.from({length:24},(_,i)=>({
  id:String(i+1),title:i===0?'理解 Acomet 的模块接入':'验收资料 '+(i+1),source:'验收资料',source_type:SOURCE_TYPES[i%6],author:'测试作者',
  abstract:'工具页面在独立的沙箱中运行，通过宿主提供的接口获取主题和登录凭据。阅读这些摘要可以先了解内容，再决定是否打开原文。\n\n后端仍保留在本机，只有名单中的账号能读取资料。',
  link:'https://example.org/reading/'+(i+1),copied_lark_link:i===0?'https://example.feishu.cn/docx/test':null,
  source_created_at:'2026-11-16T02:00:00Z',created_at:'2026-11-16T03:00:00Z',updated_at:'2026-11-16T03:00:00Z',
}));
const module=await Test.createTestingModule({imports:[AppModule]})
  .overrideProvider(DatabaseService).useValue({})
  .overrideProvider(MediaService).useValue({
    health:()=>({status:'ok'}),
    list:filters=>{
      let data=records.filter(record=>record.title.includes(filters.title??''));
      const counts=Object.fromEntries(SOURCE_TYPES.map(type=>[type,data.filter(record=>record.source_type===type).length]));
      if(filters.source_type)data=data.filter(record=>record.source_type===filters.source_type);
      const total=data.length,start=(filters.page-1)*filters.page_size;
      return {data:data.slice(start,start+filters.page_size),source_type_counts:counts,pagination:{page:filters.page,page_size:filters.page_size,total,total_pages:Math.ceil(total/filters.page_size)}};
    },
    detail:id=>{const record=records.find(record=>record.id===id);if(!record)throw new KeeperError('not_found','未找到该收藏');return {data:record};},
  }).compile();
const app=configureApi(module.createNestApplication({logger:false}),{
  issuer:'http://127.0.0.1:4310',moduleId:'media-keeper',moduleOrigin:'http://localhost:5174',
  allowedSubs:[pairwiseSubject('acomet-local-dev','alice','media-keeper')],
});
await app.listen(3002,'127.0.0.1');
console.log('Acomet fixture API listening on 127.0.0.1:3002');

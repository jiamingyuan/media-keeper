import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Test } from '@nestjs/testing';
import { AppModule } from '../apps/api/dist/app.module.js';
import { DatabaseService } from '../apps/api/dist/database.service.js';
import { configureApi } from '../apps/api/dist/application.js';
import { connect, readDatabaseConfig } from '@media-keeper/db';
import { readConfig } from '../skills/media-keeper/scripts/config.mjs';
async function start(database) {
  const module = await Test.createTestingModule({ imports:[AppModule] }).overrideProvider(DatabaseService).useValue(database).compile();
  const app = configureApi(module.createNestApplication({logger:false}));
  await app.listen(0,'127.0.0.1');
  return { app, url:await app.getUrl() };
}
async function request(url, query, route='/api/media') {
  const response=await fetch(url+route+(query ? '?'+new URLSearchParams(query) : ''));
  return { status:response.status, body:await response.json() };
}
test('HTTP rejects invalid input before DB access and sanitizes connection errors', async () => {
  let calls=0;
  const {app,url}=await start({read:async () => {calls++; throw Object.assign(new Error('secret password and SQL'),{code:'ECONNREFUSED'});}});
  try {
    for (const query of [{page:'-1'},{page_size:'1000'},{source_created_at:'2026-02-30'},{source_type:'bad'},{source_type:'blog'},{published:'bad'},{published:'today',source_created_at:'2026-10-23'},{unknown:'value'}]) {
      assert.equal((await request(url,query)).status,400);
    }
    assert.equal((await fetch(url+'/api/media?title=a&title=b')).status,400);
    for (const id of ['0','-1','abc','18446744073709551616']) assert.equal((await request(url,null,'/api/media/'+id)).status,400);
    assert.equal(calls,0);
    const failed=await request(url,null);
    assert.equal(failed.status,503); assert.equal(failed.body.error.code,'database_unavailable');
    assert.doesNotMatch(JSON.stringify(failed.body),/secret|password|SQL/);
    assert.equal((await request(url,null,'/api/media/types')).body.data.length,6);
    assert.equal((await fetch(url+'/api/media',{method:'POST'})).status,404);
  } finally {await app.close();}
});
test('real MySQL HTTP filters, date boundaries, pagination, detail and rollback',
 {skip:process.env.MEDIA_KEEPER_INTEGRATION!=='1'}, async () => {
  const config=await readConfig();
  const db=await connect(config);
  const [before]=await db.query('SELECT COUNT(*) AS count FROM useful_docs');
  const source='media-api-test-'+Date.now()+'-'+process.pid;
  let app;
  try {
    await db.beginTransaction();
    const fixtures=[
      ['Before AlphaX1000', 'article', '之前', '2026-10-22 15:59:59.999999'],
      ["Start Alpha_100% O'Reilly", 'tech_doc', '甲作者', '2026-10-22 16:00:00.000000'],
      ['End Beta', 'podcast', '甲作者', '2026-10-23 15:59:59.999999'],
      ['After Gamma', 'paper', '乙作者', '2026-10-23 16:00:00.000000'],
      ['Unknown time', 'project_repo', null, null],
      ['Middle Video', 'video', '丙作者', '2026-10-23 05:00:00.123456']
    ];
    const ids=[];
    for (const [title,type,author,date] of fixtures) {
      const [result]=await db.execute('INSERT INTO useful_docs(title,abstract,source,source_type,author,source_created_at,link) VALUES(?,?,?,?,?,?,?)',
        [title,'测试摘要',source,type,author,date,'https://example.org/'+source+'/'+ids.length]);
      ids.push(String(result.insertId));
    }
    const server=await start({read:task=>task(db)}); app=server.app; const url=server.url;
    const list=async query => {const result=await request(url,{source,...query}); assert.equal(result.status,200,JSON.stringify(result.body)); return result.body;};
    assert.equal((await list({})).pagination.total,6);
    assert.deepEqual((await list({source_type:'article',page_size:'1'})).source_type_counts,
      {article:1,paper:1,podcast:1,video:1,tech_doc:1,project_repo:1});
    assert.deepEqual((await list({source_created_at:'2026-10-23'})).source_type_counts,
      {article:0,paper:0,podcast:1,video:1,tech_doc:1,project_repo:0});
    assert.equal((await list({published:'all'})).pagination.total,6);
    assert.equal((await list({title:'Alpha_100%'})).data[0].id,ids[1]);
    assert.equal((await list({title:'Alpha_100%'})).pagination.total,1);
    assert.equal((await list({author:'甲作者'})).pagination.total,2);
    for (const [,type] of fixtures) assert.equal((await list({source_type:type})).pagination.total,1);
    assert.deepEqual((await list({source_created_at:'2026-10-23'})).data.map(row=>row.id).sort(),[ids[1],ids[2],ids[5]].sort());
    const combined=await list({title:'Alpha_100%',source_type:'tech_doc',author:'甲',source_created_at:'2026-10-23'});
    assert.equal(combined.pagination.total,1); assert.equal(combined.data[0].id,ids[1]);
    assert.equal((await list({title:"' OR 1=1 --"})).pagination.total,0);
    assert.equal((await list({source:source+'missing'})).pagination.total,0);
    const pages=[];
    for (let page=1;page<=3;page++) pages.push(...(await list({page:String(page),page_size:'2'})).data.map(row=>row.id));
    assert.equal(new Set(pages).size,6); assert.deepEqual([...pages].sort(),[...ids].sort());
    const sorted=await list({sort_by:'source_created_at',sort_order:'asc'});
    assert.equal(sorted.data[0].id,ids[0]); assert.equal(sorted.data.at(-1).id,ids[4]);
    const empty=await list({page:'20'}); assert.deepEqual(empty.data,[]); assert.equal(empty.pagination.total,6);
    const detail=await request(url,null,'/api/media/'+ids[2]);
    assert.equal(detail.status,200); assert.equal(detail.body.data.source_created_at,'2026-10-23T15:59:59.999999Z');
    assert.equal(typeof detail.body.data.id,'string');
    assert.equal((await request(url,null,'/api/media/18446744073709551615')).status,404);
    assert.equal((await request(url,null,'/api/health')).body.status,'ok');
  } finally {
    if(app) await app.close();
    await db.rollback();
    const [after]=await db.query('SELECT COUNT(*) AS count FROM useful_docs');
    await db.end();
    assert.equal(after[0].count,before[0].count);
  }
});
test('deployed API account can read but cannot insert', {skip:process.env.MEDIA_KEEPER_INTEGRATION!=='1'}, async () => {
  const config=await readDatabaseConfig(process.env.MEDIA_KEEPER_API_CONFIG || new URL('../runtime/api.local.json',import.meta.url));
  const db=await connect(config);
  try {
    await db.query('SELECT COUNT(*) FROM useful_docs');
    await db.beginTransaction();
    await assert.rejects(db.execute('INSERT INTO useful_docs(title,abstract,source,source_type,link) VALUES(?,?,?,?,?)',
      ['permission test','测试','test','article','https://example.org/permission-test']),error=>error.code==='ER_TABLEACCESS_DENIED_ERROR');
  } finally { await db.rollback(); await db.end(); }
});

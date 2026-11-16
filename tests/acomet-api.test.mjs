import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { KeyObject, sign } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { generateSigningKey, jwks } from '@acomet/server-sdk/issuer';
import { AppModule } from '../apps/api/dist/app.module.js';
import { MediaService } from '../apps/api/dist/media.service.js';
import { DatabaseService } from '../apps/api/dist/database.service.js';
import { configureApi } from '../apps/api/dist/application.js';
import { readAcometConfig } from '../apps/api/dist/acomet.js';

test('Acomet config requires explicit users, exact origins and valid enablement', () => {
  assert.equal(readAcometConfig({}), undefined);
  for (const env of [{ACOMET_ENABLED:'true'}, {ACOMET_ENABLED:'1'}, {ACOMET_ENABLED:'1',ACOMET_ALLOWED_SUBS:'*'},
    {ACOMET_ENABLED:'1',ACOMET_ALLOWED_SUBS:'u_111111111111111111111111',ACOMET_ISSUER:'https://acomet.app/path'},
    {ACOMET_ENABLED:'1',ACOMET_ALLOWED_SUBS:'u_111111111111111111111111',ACOMET_ISSUER:'http://untrusted.example'},
    {ACOMET_ENABLED:'1',ACOMET_ALLOWED_SUBS:'u_111111111111111111111111',ACOMET_MODULE_ORIGIN:'https://other.acometmodule.app'}]) {
    assert.throws(() => readAcometConfig(env));
  }
  const config=readAcometConfig({ACOMET_ENABLED:'1',ACOMET_ALLOWED_SUBS:'u_111111111111111111111111,u_111111111111111111111111'});
  assert.equal(config.issuer,'https://acomet.app');
  assert.equal(config.moduleOrigin,'https://media-keeper.acometmodule.app');
  assert.equal(config.allowedSubs.length,1);
});

test('Acomet APIs verify signed tokens and subjects, with health and CORS preflight exempt', async t => {
  const key=await generateSigningKey('test-key');
  const other=await generateSigningKey('other-key');
  const server=createServer((req,res) => {res.setHeader('Content-Type','application/json');res.end(JSON.stringify(jwks([key])));});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const issuer='http://127.0.0.1:'+server.address().port;
  const own='u_111111111111111111111111', outsider='u_222222222222222222222222';
  const moduleOrigin='http://localhost:5174';
  let reads=0;
  const module=await Test.createTestingModule({imports:[AppModule]})
    .overrideProvider(DatabaseService).useValue({})
    .overrideProvider(MediaService).useValue({health:()=>({status:'ok'}),list:()=>{reads++;return {data:[]};},detail:()=>{reads++;return {data:{id:'1'}};}}).compile();
  const app=configureApi(module.createNestApplication({logger:false}),{issuer,moduleId:'media-keeper',moduleOrigin,allowedSubs:[own]});
  await app.listen(0,'127.0.0.1');
  const url=await app.getUrl();
  function token(patch={}, header={}, signingKey=key) {
    const now=Math.floor(Date.now()/1000);
    const payload={iss:issuer,aud:'media-keeper',sub:own,iat:now,exp:now+300,ver:1,plan:'free',scope:[],...patch};
    const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
    const input=encode({alg:'ES256',kid:key.kid,typ:'acomet-module+jwt',...header})+'.'+encode(payload);
    return input+'.'+sign('sha256',Buffer.from(input),{key:KeyObject.from(signingKey.privateKey),dsaEncoding:'ieee-p1363'}).toString('base64url');
  }
  const get=(path, jwt, extra={}) => fetch(url+path,{headers:{...(jwt?{authorization:'Bearer '+jwt}:{}),...extra}});
  try {
    await t.test('all collection and unknown endpoints require a token, including loopback traffic',async()=>{
      for(const path of ['/api/media','/api/media/1','/api/media/types','/api/unknown']) assert.equal((await get(path)).status,401);
      assert.equal((await get('/api/media',null,{'X-Forwarded-For':'127.0.0.1'})).status,401);
      assert.equal(reads,0);
      assert.equal((await get('/api/health')).status,200);
    });
    await t.test('reject expiry, issuer, audience, type, algorithm, TTL, format and signature errors',async()=>{
      const now=Math.floor(Date.now()/1000);
      for(const jwt of ['malformed',token({iat:now-400,exp:now-100}),token({iss:'https://other.example'}),
        token({aud:'other-module'}),token({}, {typ:'JWT'}),token({}, {alg:'HS256'}),
        token({exp:now+3600}),token({ver:2}),token({}, {}, other)]) {
        assert.equal((await get('/api/media',jwt)).status,401);
      }
      assert.equal(reads,0);
    });
    await t.test('valid token for another user is forbidden and does not read data',async()=>{
      assert.equal((await get('/api/media',token({sub:outsider}))).status,403);
      assert.equal(reads,0);
    });
    await t.test('allowlisted user can query list, types and detail without cookies',async()=>{
      for(const path of ['/api/media','/api/media/1','/api/media/types']) assert.equal((await get(path,token())).status,200);
      assert.equal(reads,2);
    });
    await t.test('CORS allows only the configured module and handles unauthenticated OPTIONS',async()=>{
      const response=await fetch(url+'/api/media',{method:'OPTIONS',headers:{origin:moduleOrigin,'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization'}});
      assert.equal(response.status,204);
      assert.equal(response.headers.get('access-control-allow-origin'),moduleOrigin);
      assert.match(response.headers.get('access-control-allow-headers'),/authorization/i);
      assert.equal(response.headers.get('access-control-allow-credentials'),null);
      const refused=await get('/api/media',token(),{origin:'https://untrusted.example'});
      assert.notEqual(refused.headers.get('access-control-allow-origin'),'https://untrusted.example');
      assert.notEqual(refused.headers.get('access-control-allow-origin'),'*');
    });
  } finally {await app.close();await new Promise(resolve=>server.close(resolve));}
});

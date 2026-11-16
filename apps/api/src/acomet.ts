import type { INestApplication } from '@nestjs/common';
import { bearerToken, createModuleTokenVerifier } from '@acomet/server-sdk';

export interface AcometConfig {
  issuer: string;
  moduleId: string;
  moduleOrigin: string;
  allowedSubs: readonly string[];
}

function origin(value: string) {
  const url = new URL(value);
  if (url.origin !== value || url.username || url.password ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) {
    throw new Error('Acomet requires an HTTPS origin, or an HTTP loopback origin for local development');
  }
  return url;
}

export function readAcometConfig(env: NodeJS.ProcessEnv = process.env): AcometConfig | undefined {
  if (env.ACOMET_ENABLED === undefined || env.ACOMET_ENABLED === '0') return undefined;
  if (env.ACOMET_ENABLED !== '1') throw new Error('ACOMET_ENABLED must be 0 or 1');
  const issuer = env.ACOMET_ISSUER ?? 'https://acomet.app';
  const issuerUrl = origin(issuer);
  const moduleId = 'media-keeper';
  const moduleOrigin = env.ACOMET_MODULE_ORIGIN ?? `https://${moduleId}.acometmodule.app`;
  origin(moduleOrigin);
  if (issuerUrl.protocol === 'https:' && moduleOrigin !== `https://${moduleId}.acometmodule.app`) {
    throw new Error('Production CORS must use the media-keeper module origin');
  }
  const allowedSubs = [...new Set((env.ACOMET_ALLOWED_SUBS ?? '').split(',').map(value => value.trim()).filter(Boolean))];
  if (!allowedSubs.length || allowedSubs.some(sub => !/^u_[0-9a-f]{24}$/.test(sub))) {
    throw new Error('ACOMET_ALLOWED_SUBS must contain explicit module-specific user ids');
  }
  return { issuer, moduleId, moduleOrigin, allowedSubs };
}

export function configureAcomet(app: INestApplication, config: AcometConfig) {
  const verify = createModuleTokenVerifier({ moduleId: config.moduleId, issuer: config.issuer });
  const allowed = new Set(config.allowedSubs);
  app.enableCors({
    origin: config.moduleOrigin,
    methods: ['GET', 'OPTIONS'], allowedHeaders: ['Authorization', 'Content-Type'],
    credentials: false, maxAge: 600,
  });
  app.use((req: { method: string; path: string; headers: { authorization?: string } },
    res: { status: (code: number) => { json: (body: object) => void } }, next: () => void) => {
    if (req.method === 'OPTIONS' || (req.method === 'GET' && /^\/api\/health\/?$/.test(req.path))) return next();
    void (async () => {
      let sub: string;
      try { sub = (await verify(bearerToken(req.headers.authorization))).sub; }
      catch {
        res.status(401).json({ error: { code: 'unauthorized', message: '需要有效的 Acomet 模块令牌' }, statusCode: 401 });
        return;
      }
      if (!allowed.has(sub)) {
        res.status(403).json({ error: { code: 'forbidden', message: '此账号没有访问该资料库的权限' }, statusCode: 403 });
        return;
      }
      next();
    })();
  });
}

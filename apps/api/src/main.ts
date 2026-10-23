import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApi } from './application.js';
import { readApiConfig } from './config.js';
async function bootstrap() {
  const config = await readApiConfig();
  const app = configureApi(await NestFactory.create(AppModule));
  await app.listen(config.server.port, config.server.host);
  console.log(`media-keeper API: http://${config.server.host}:${config.server.port}/api`);
}
bootstrap().catch(() => { console.error('API 启动失败，请检查数据库、本地配置和端口。'); process.exitCode = 1; });

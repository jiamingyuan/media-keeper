import 'reflect-metadata';
import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter, type INestApplication } from '@nestjs/common';
import { KeeperError } from '@media-keeper/core';
@Catch()
class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    let status = 500, code = 'internal_error', message: string | object = '服务暂时无法处理请求';
    if (error instanceof HttpException) {
      status = error.getStatus(); code = status === 404 ? 'not_found' : 'invalid_request'; message = error.getResponse();
    } else if (error instanceof KeeperError) {
      status = error.code === 'not_found' ? 404 : 400; code = error.code; message = error.message;
    } else if (error && typeof error === 'object' && 'code' in error) {
      status = 503; code = 'database_unavailable'; message = '数据库暂时不可用';
    }
    host.switchToHttp().getResponse().status(status).json({ error: { code, message }, statusCode: status });
  }
}
export function configureApi(app: INestApplication) {
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  return app;
}

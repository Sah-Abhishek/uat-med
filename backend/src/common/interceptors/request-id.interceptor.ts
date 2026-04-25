import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { v4 as uuid } from 'uuid';

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();

    const incoming = req.headers['x-request-id'] as string | undefined;
    const id = incoming && /^[a-zA-Z0-9_\-]{8,128}$/.test(incoming) ? incoming : `req_${uuid()}`;
    req.headers['x-request-id'] = id;
    res.setHeader('X-Request-Id', id);

    const start = Date.now();
    return new Observable(subscriber => {
      const sub = next.handle().subscribe({
        next: v => subscriber.next(v),
        error: e => {
          res.setHeader('X-Response-Time-Ms', String(Date.now() - start));
          subscriber.error(e);
        },
        complete: () => {
          res.setHeader('X-Response-Time-Ms', String(Date.now() - start));
          subscriber.complete();
        },
      });
      return () => sub.unsubscribe();
    });
  }
}

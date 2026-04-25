import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal_error';
    let message = 'Unexpected error';
    let field: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse() as any;
      if (typeof resp === 'string') {
        message = resp;
        code = this.codeForStatus(status);
      } else if (resp && typeof resp === 'object') {
        if (resp.error && typeof resp.error === 'object') {
          code = resp.error.code ?? this.codeForStatus(status);
          message = resp.error.message ?? message;
          field = resp.error.field;
        } else {
          // class-validator default shape: { message: string[] | string, error, statusCode }
          code = status === 400 || status === 422 ? 'validation_error' : this.codeForStatus(status);
          message = Array.isArray(resp.message) ? resp.message[0] : (resp.message ?? message);
        }
      }
    } else if (exception instanceof QueryFailedError) {
      const err: any = exception;
      if (err.code === '23505') { status = HttpStatus.CONFLICT; code = 'conflict'; message = 'Unique constraint violation.'; }
      else if (err.code === '23503') { status = HttpStatus.CONFLICT; code = 'conflict'; message = 'Foreign key violation.'; }
      else { this.logger.error(err.message, err.stack); }
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    res.status(status).json({
      error: {
        code,
        message,
        ...(field ? { field } : {}),
        requestId: req.headers['x-request-id'] ?? undefined,
      },
    });
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case 400: return 'bad_request';
      case 401: return 'unauthorized';
      case 403: return 'forbidden';
      case 404: return 'not_found';
      case 409: return 'conflict';
      case 422: return 'validation_error';
      case 429: return 'rate_limited';
      default:  return 'internal_error';
    }
  }
}

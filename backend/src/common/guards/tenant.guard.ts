import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '../enums/roles.enum';

/**
 * Ensures the caller's clientId / locationId scope matches the requested resource
 * (admins bypass). Controllers opt-in by applying this guard explicitly.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user) return false;
    if (user.role === Role.ADMIN) return true;

    const requestedClientId = Number(req.query?.clientId ?? req.body?.clientId ?? user.clientId);
    const requestedLocationId = Number(req.query?.locationId ?? req.body?.locationId ?? user.locationId);

    if (user.clientId && requestedClientId && user.clientId !== requestedClientId) {
      throw new ForbiddenException({ error: { code: 'forbidden', message: 'Client scope mismatch.' } });
    }
    if (user.locationId && requestedLocationId && user.locationId !== requestedLocationId) {
      throw new ForbiddenException({ error: { code: 'forbidden', message: 'Location scope mismatch.' } });
    }
    return true;
  }
}

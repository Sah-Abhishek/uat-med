import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../enums/roles.enum';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;
    // TEAMLEAD always passes.
    if (user.role === Role.TEAMLEAD) return true;

    if (!required.includes(user.role)) {
      // Surface the mismatch so a stale JWT (e.g. token issued before a role
      // change) is obvious from the response body alone — saves a debugging
      // round-trip to inspect the token claim.
      throw new ForbiddenException({
        error: {
          code: 'forbidden',
          message: `Insufficient role for this endpoint. Token role: ${user.role ?? '(none)'}; required: ${required.join(' | ')}.`,
        },
      });
    }
    return true;
  }
}

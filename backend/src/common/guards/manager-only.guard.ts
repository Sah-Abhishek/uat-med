import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '../enums/roles.enum';

/**
 * Hard MANAGER-only gate.
 *
 * Unlike {@link RolesGuard} — where TEAMLEAD and MANAGER are both treated as
 * super-roles that pass EVERY `@Roles()` check — this guard admits only the
 * MANAGER role, so Team Leads (and everyone else) are excluded. Used for the
 * allocation-history audit page, which is manager-exclusive by product decision.
 *
 * Runs after the global JwtAuthGuard, so `req.user` is already populated.
 */
@Injectable()
export class ManagerOnlyGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const { user } = ctx.switchToHttp().getRequest();
    if (user?.role === Role.MANAGER) return true;
    throw new ForbiddenException({
      error: {
        code: 'forbidden',
        message: 'This page is restricted to Manager accounts.',
      },
    });
  }
}

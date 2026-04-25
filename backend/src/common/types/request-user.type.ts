import { Role } from '../enums/roles.enum';

/** Shape of the user attached to `request.user` by JwtStrategy.validate(). */
export interface AuthenticatedUser {
  id: number;
  email: string;
  fullName?: string;
  role: Role;
  clientId?: number | null;
  locationId?: number | null;
  ssoProvider?: string;
  ssoSessionId?: string;
  jti?: string;
}

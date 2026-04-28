import { JwtService } from '@nestjs/jwt';
import { TestingModule } from '@nestjs/testing';
import { Role } from '../../src/common/enums/roles.enum';

export interface TestUserPayload {
  id: number;
  email?: string;
  role: Role;
  clientId?: number | null;
  locationId?: number | null;
}

/** Issues a real JWT signed with the test secret. Use as Authorization: Bearer <token>. */
export function signAsUser(moduleRef: TestingModule, u: TestUserPayload): string {
  const jwt = moduleRef.get(JwtService);
  return jwt.sign({
    sub: String(u.id),
    email: u.email ?? `${u.role.toLowerCase()}-${u.id}@test.local`,
    role: u.role,
    clientId: u.clientId ?? null,
    locationId: u.locationId ?? null,
  });
}

export const asCoder   = (moduleRef: TestingModule, id = 1001) => signAsUser(moduleRef, { id, role: Role.CODER, clientId: 7, locationId: 12 });
export const asAuditor = (moduleRef: TestingModule, id = 1002) => signAsUser(moduleRef, { id, role: Role.AUDITOR, clientId: 7, locationId: 12 });
export const asManager = (moduleRef: TestingModule, id = 1003) => signAsUser(moduleRef, { id, role: Role.MANAGER, clientId: 7, locationId: 12 });
export const asAdmin   = (moduleRef: TestingModule, id = 1004) => signAsUser(moduleRef, { id, role: Role.TEAMLEAD });

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * Auth (e2e) — covers TC-AUTH-001 … TC-AUTH-016
 * See valerion-test-cases.xlsx for full test case documentation.
 */
import { INestApplication } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthService } from '../src/modules/auth/auth.service';
import { LocalStrategy } from '../src/modules/auth/strategies/local.strategy';
import { buildTestApp } from './helpers/app-factory';
import { asCoder, bearer } from './helpers/auth-helpers';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let authSvc: jest.Mocked<Partial<AuthService>>;

  beforeAll(async () => {
    authSvc = {
      signup: jest.fn().mockResolvedValue({ status: 'pending', message: 'Signup request submitted for approval' }),
      validatePassword: jest.fn().mockImplementation((username: string, password: string) => {
        if (username === 'valid@valerionhealth.in' && password === 'Correct123!') {
          return Promise.resolve({ id: 1001, email: username, role: 'CODER' });
        }
        return Promise.resolve(null);
      }),
      issueTokensForUser: jest.fn().mockResolvedValue({
        accessToken: 'eyJ.jwt.here', tokenType: 'bearer', expiresIn: 1800, refreshToken: 'a'.repeat(64),
        user: { id: 1001, email: 'valid@valerionhealth.in', role: 'CODER', fullName: 'T', clientId: 7, locationId: 12 },
      }),
      refresh: jest.fn().mockResolvedValue({ accessToken: 'new.jwt', refreshToken: 'new-rt', expiresIn: 1800 }),
      logout: jest.fn().mockResolvedValue({ status: 'ok' }),
      logoutAll: jest.fn().mockResolvedValue({ status: 'ok', revoked: 3 }),
      me: jest.fn().mockResolvedValue({ id: 1001, email: 'valid@valerionhealth.in', role: 'CODER' }),
      changePassword: jest.fn().mockResolvedValue({ status: 'ok' }),
    };
    const built = await buildTestApp({
      controllers: [AuthController],
      providers: [LocalStrategy, { provide: AuthService, useValue: authSvc }],
    });
    app = built.app; moduleRef = built.moduleRef;
  });
  afterAll(async () => { await app.close(); });

  it('TC-AUTH-001: POST /auth/signup with valid email returns 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup').send({ email: 'new.user@valerionhealth.in' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
  });

  it('TC-AUTH-002: POST /auth/signup rejects invalid email format', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup').send({ email: 'not-an-email' });
    expect([400, 401, 422]).toContain(res.status);
  });

  it('TC-AUTH-003: POST /auth/signup rejects missing email', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/signup').send({});
    expect([400, 401, 422]).toContain(res.status);
  });

  it('TC-AUTH-004: POST /auth/login with valid credentials returns tokens', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login').send({ username: 'valid@valerionhealth.in', password: 'Correct123!' });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.user.role).toBe('CODER');
  });

  it('TC-AUTH-005: POST /auth/login with wrong password returns 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login').send({ username: 'valid@valerionhealth.in', password: 'WRONG' });
    expect(res.status).toBe(401);
  });

  it('TC-AUTH-006: POST /auth/login with non-existent user returns 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login').send({ username: 'ghost@valerionhealth.in', password: 'any' });
    expect(res.status).toBe(401);
  });

  it('TC-AUTH-007: POST /auth/login rejects missing fields', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({});
    expect([400, 401, 422]).toContain(res.status);
  });

  it('TC-AUTH-008: POST /auth/refresh with valid token returns new pair', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh').send({ refreshToken: 'x'.repeat(32) });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBe('new.jwt');
  });

  it('TC-AUTH-009: POST /auth/refresh rejects invalid token shape', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({});
    expect([400, 401, 422]).toContain(res.status);
  });

  it('TC-AUTH-010: POST /auth/logout revokes current token', async () => {
    const token = asCoder(moduleRef);
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/logout').set(bearer(token)).send({ refreshToken: 'a'.repeat(64) });
    expect(res.status).toBe(200);
  });

  it('TC-AUTH-011: POST /auth/logout/all revokes everything', async () => {
    const token = asCoder(moduleRef);
    const res = await request(app.getHttpServer()).post('/api/v1/auth/logout/all').set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.revoked).toBe(3);
  });

  it('TC-AUTH-012: GET /auth/me with valid token returns 200', async () => {
    const token = asCoder(moduleRef);
    const res = await request(app.getHttpServer()).get('/api/v1/auth/me').set(bearer(token));
    expect(res.status).toBe(200);
  });

  it('TC-AUTH-013: GET /auth/me without token returns 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('TC-AUTH-014: GET /auth/me with malformed token returns 401', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/me').set({ Authorization: 'Bearer not-a-real-jwt' });
    expect(res.status).toBe(401);
  });

  it('TC-AUTH-015: POST /auth/password/change with valid data returns 200', async () => {
    const token = asCoder(moduleRef);
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/password/change').set(bearer(token))
      .send({ currentPassword: 'OldPass123!', newPassword: 'NewPass123!XYZ' });
    expect(res.status).toBe(200);
  });

  it('TC-AUTH-016: POST /auth/password/change rejects weak new password', async () => {
    const token = asCoder(moduleRef);
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/password/change').set(bearer(token))
      .send({ currentPassword: 'OldPass123!', newPassword: 'weak' });
    expect([400, 401, 422]).toContain(res.status);
  });
});

/**
 * Users (e2e) — covers TC-USER-001 … TC-USER-015
 */
import { INestApplication } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { UsersController } from '../src/modules/users/users.controller';
import { UsersService } from '../src/modules/users/users.service';
import { buildTestApp } from './helpers/app-factory';
import { asAdmin, asManager, asCoder, bearer, signAsUser } from './helpers/auth-helpers';
import { Role } from '../src/common/enums/roles.enum';

describe('Users (e2e)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let svc: jest.Mocked<Partial<UsersService>>;

  beforeAll(async () => {
    svc = {
      list: jest.fn().mockResolvedValue({ items: [{ id: 5201, fullName: 'John D' }], total: 78, page: 1, pageSize: 20 }),
      stats: jest.fn().mockResolvedValue({ active: 78, inactive: 1, pending: 1 }),
      create: jest.fn().mockResolvedValue({ id: 5999 }),
      detail: jest.fn().mockResolvedValue({ id: 5201, fullName: 'John D' }),
      update: jest.fn().mockResolvedValue({ id: 5201, fullName: 'Updated' }),
      deactivate: jest.fn().mockResolvedValue({ status: 'INACTIVE' }),
      activate: jest.fn().mockResolvedValue({ status: 'ACTIVE' }),
      attendance: jest.fn().mockResolvedValue({ month: '2026-04', presentDays: 16 }),
      markAttendance: jest.fn().mockResolvedValue({ id: 1, userId: 5201, date: '2026-04-18', status: 'PRESENT' }),
      signupRequests: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
      approveSignup: jest.fn().mockResolvedValue({ userId: 6001, status: 'ACTIVE' }),
      declineSignup: jest.fn().mockResolvedValue({ status: 'DECLINED' }),
    };
    const built = await buildTestApp({ controllers: [UsersController], providers: [{ provide: UsersService, useValue: svc }] });
    app = built.app; moduleRef = built.moduleRef;
  });
  afterAll(async () => { await app.close(); });

  it('TC-USER-001: GET /users as MANAGER', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/users').set(bearer(asManager(moduleRef)));
    expect(res.status).toBe(200);
  });
  it('TC-USER-002: GET /users as CODER returns 403', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/users').set(bearer(asCoder(moduleRef)));
    expect(res.status).toBe(403);
  });
  it('TC-USER-003: GET /users/stats', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/users/stats').set(bearer(asManager(moduleRef)));
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(78);
  });
  it('TC-USER-004: POST /users as ADMIN', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/users').set(bearer(asAdmin(moduleRef)))
      .send({ email: 'new@valerionhealth.in', fullName: 'New User', password: 'Temp1234Aa!', role: 'CODER' });
    expect(res.status).toBe(201);
  });
  it('TC-USER-005: POST /users as MANAGER returns 403', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/users').set(bearer(asManager(moduleRef)))
      .send({ email: 'new@valerionhealth.in', fullName: 'N', password: 'Temp1234!', role: 'CODER' });
    expect(res.status).toBe(403);
  });
  it('TC-USER-006: POST /users with invalid email returns 422', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/users').set(bearer(asAdmin(moduleRef)))
      .send({ email: 'bad', fullName: 'N', password: 'Temp1234!', role: 'CODER' });
    expect([400, 422]).toContain(res.status);
  });
  it('TC-USER-007: GET /users/:id as self', async () => {
    const token = signAsUser(moduleRef, { id: 5201, role: Role.CODER });
    const res = await request(app.getHttpServer()).get('/api/v1/users/5201').set(bearer(token));
    expect(res.status).toBe(200);
  });
  it('TC-USER-008: GET /users/:id as ADMIN', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/users/5201').set(bearer(asAdmin(moduleRef)));
    expect(res.status).toBe(200);
  });
  it('TC-USER-009: PATCH /users/:id as self', async () => {
    const token = signAsUser(moduleRef, { id: 5201, role: Role.CODER });
    const res = await request(app.getHttpServer())
      .patch('/api/v1/users/5201').set(bearer(token)).send({ fullName: 'Updated' });
    expect(res.status).toBe(200);
  });
  it('TC-USER-010: POST /users/:id/deactivate as ADMIN', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/users/5201/deactivate').set(bearer(asAdmin(moduleRef))).send({ reason: 'Resigned' });
    expect(res.status).toBe(200);
  });
  it('TC-USER-011: POST /users/:id/activate as ADMIN', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/users/5201/activate').set(bearer(asAdmin(moduleRef)));
    expect(res.status).toBe(200);
  });
  it('TC-USER-012: GET /users/:id/attendance', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/users/5201/attendance').query({ month: '2026-04' }).set(bearer(asManager(moduleRef)));
    expect(res.status).toBe(200);
  });
  it('TC-USER-013: POST /users/:id/attendance/mark', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/users/5201/attendance/mark').set(bearer(asAdmin(moduleRef)))
      .send({ date: '2026-04-18', status: 'PRESENT' });
    expect(res.status).toBe(200);
  });
  it('TC-USER-014: POST /users/signup-requests/:id/approve', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/users/signup-requests/301/approve').set(bearer(asAdmin(moduleRef)))
      .send({ email: 'x@valerionhealth.in', fullName: 'X', password: 'Temp1234Aa!', role: 'CODER' });
    expect(res.status).toBe(200);
  });
  it('TC-USER-015: POST /users/signup-requests/:id/decline', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/users/signup-requests/301/decline').set(bearer(asAdmin(moduleRef)))
      .send({ reason: 'Not valid' });
    expect(res.status).toBe(200);
  });
});

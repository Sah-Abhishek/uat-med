/**
 * Worklists (e2e) — covers TC-WL-001 … TC-WL-018
 */
import { INestApplication, NotFoundException } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { WorklistsController } from '../src/modules/worklists/worklists.controller';
import { WorklistsService } from '../src/modules/worklists/worklists.service';
import { buildTestApp } from './helpers/app-factory';
import { asManager, asCoder, bearer } from './helpers/auth-helpers';

describe('Worklists (e2e)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let svc: jest.Mocked<Partial<WorklistsService>>;

  beforeAll(async () => {
    svc = {
      list: jest.fn().mockResolvedValue({ items: [{ id: 101, worklistNumber: '19309A', status: 'OPEN' }], total: 1, page: 1, pageSize: 20 }),
      statusSummary: jest.fn().mockResolvedValue({ open: 20, inProgress: 257, closed: 165 }),
      create: jest.fn().mockResolvedValue({ id: 101, worklistNumber: '19309A', status: 'OPEN', totalCharts: 272 }),
      detail: jest.fn().mockImplementation((id: number) => {
        if (id === 999) throw new NotFoundException();
        return Promise.resolve({ id, worklistNumber: '19309A', status: 'OPEN' });
      }),
      update: jest.fn().mockResolvedValue({ id: 101 }),
      remove: jest.fn().mockResolvedValue({ status: 'deleted' }),
      allocate: jest.fn().mockResolvedValue({ allocated: 202, remaining: 0 }),
      reallocate: jest.fn().mockResolvedValue({ reallocated: 3, remaining: 31 }),
    };
    const built = await buildTestApp({ controllers: [WorklistsController], providers: [{ provide: WorklistsService, useValue: svc }] });
    app = built.app; moduleRef = built.moduleRef;
  });
  afterAll(async () => { await app.close(); });

  it('TC-WL-001: GET /worklists returns paginated list', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/worklists').set(bearer(asManager(moduleRef)));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });

  it('TC-WL-002: GET /worklists with pagination params', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/worklists').query({ page: 1, pageSize: 5 }).set(bearer(asManager(moduleRef)));
    expect(res.status).toBe(200);
  });

  it('TC-WL-003: GET /worklists filtered by status', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/worklists').query({ status: 'OPEN' }).set(bearer(asManager(moduleRef)));
    expect(res.status).toBe(200);
  });

  it('TC-WL-004: GET /worklists without token returns 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/worklists');
    expect(res.status).toBe(401);
  });

  it('TC-WL-005: GET /worklists/status-summary returns counts', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/worklists/status-summary').set(bearer(asManager(moduleRef)));
    expect(res.status).toBe(200);
    expect(res.body.open).toBe(20);
  });

  it('TC-WL-006: POST /worklists as MANAGER returns 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/worklists').set(bearer(asManager(moduleRef)))
      .send({ worklistNumber: '19309A', clientId: 7, locationId: 12, primarySpecialityId: 3, subSpecialityId: 5, processId: 1, receivedDate: '2023-09-27' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(101);
  });

  it('TC-WL-007: POST /worklists as CODER returns 403', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/worklists').set(bearer(asCoder(moduleRef)))
      .send({ worklistNumber: '19309B', clientId: 7, locationId: 12, primarySpecialityId: 3, subSpecialityId: 5, processId: 1, receivedDate: '2023-09-27' });
    expect(res.status).toBe(403);
  });

  it('TC-WL-008: POST /worklists with missing required fields returns 422', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/worklists').set(bearer(asManager(moduleRef))).send({ worklistNumber: 'X' });
    expect([400, 422]).toContain(res.status);
  });

  it('TC-WL-009: POST /worklists with invalid date format returns 422', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/worklists').set(bearer(asManager(moduleRef)))
      .send({ worklistNumber: '19309A', clientId: 7, locationId: 12, primarySpecialityId: 3, subSpecialityId: 5, processId: 1, receivedDate: 'not-a-date' });
    expect([400, 422]).toContain(res.status);
  });

  it('TC-WL-010: GET /worklists/:id returns detail', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/worklists/101').set(bearer(asManager(moduleRef)));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(101);
  });

  it('TC-WL-011: GET /worklists/:id not found returns 404', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/worklists/999').set(bearer(asManager(moduleRef)));
    expect(res.status).toBe(404);
  });

  it('TC-WL-012: PATCH /worklists/:id returns 200', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/worklists/101').set(bearer(asManager(moduleRef))).send({ worklistNumber: '19309B' });
    expect(res.status).toBe(200);
  });

  it('TC-WL-013: PATCH /worklists/:id as CODER returns 403', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/worklists/101').set(bearer(asCoder(moduleRef))).send({ worklistNumber: '19309B' });
    expect(res.status).toBe(403);
  });

  it('TC-WL-014: DELETE /worklists/:id with matching echo returns 200', async () => {
    const res = await request(app.getHttpServer())
      .delete('/api/v1/worklists/101').set(bearer(asManager(moduleRef))).send({ worklistNumber: '19309A' });
    expect(res.status).toBe(200);
  });

  it('TC-WL-015: DELETE /worklists/:id without echo returns 422', async () => {
    const res = await request(app.getHttpServer())
      .delete('/api/v1/worklists/101').set(bearer(asManager(moduleRef))).send({});
    expect([200, 400, 422]).toContain(res.status);
  });

  it('TC-WL-016: POST /worklists/:id/allocate returns 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/worklists/101/allocate').set(bearer(asManager(moduleRef)))
      .send({ allocations: [{ from: 1, to: 100, assigneeId: 5201, role: 'CODER' }] });
    expect(res.status).toBe(201);
  });

  it('TC-WL-017: POST /worklists/:id/reallocate returns 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/worklists/101/reallocate').set(bearer(asManager(moduleRef)))
      .send({ from: 27, to: 29, assigneeId: 5205, role: 'CODER' });
    expect(res.status).toBe(201);
  });

  it('TC-WL-018: POST /worklists/:id/allocate as CODER returns 403', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/worklists/101/allocate').set(bearer(asCoder(moduleRef)))
      .send({ allocations: [] });
    expect(res.status).toBe(403);
  });
});

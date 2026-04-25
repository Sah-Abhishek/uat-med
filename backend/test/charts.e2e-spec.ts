/**
 * Charts (e2e) — covers TC-CHART-001 … TC-CHART-020
 */
import { BadRequestException, INestApplication, NotFoundException } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { ChartsController } from '../src/modules/charts/charts.controller';
import { ChartsService } from '../src/modules/charts/charts.service';
import { buildTestApp } from './helpers/app-factory';
import { asManager, asCoder, asAuditor, bearer } from './helpers/auth-helpers';

describe('Charts (e2e)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let svc: jest.Mocked<Partial<ChartsService>>;

  beforeAll(async () => {
    svc = {
      list: jest.fn().mockResolvedValue({ items: [{ id: 55001, milestone: 'READY_TO_CODE' }], total: 1, page: 1, pageSize: 20 }),
      summary: jest.fn().mockResolvedValue({ priorityCounts: { high: 31 }, milestones: { readyToCode: 2470 } }),
      detail: jest.fn().mockImplementation((id: number) => {
        if (id === 999) throw new NotFoundException();
        return Promise.resolve({ id, milestone: 'READY_TO_CODE' });
      }),
      update: jest.fn().mockResolvedValue({ id: 55001 }),
      startTimer: jest.fn().mockResolvedValue({ chartId: 55001, startedAt: '2026-04-18T09:15:22Z' }),
      stopTimer: jest.fn().mockResolvedValue({ chartId: 55001, elapsedMs: 183420 }),
      transition: jest.fn().mockImplementation((id: number, dto: any) => {
        if (dto.milestone === 'BAD_STATE') throw new BadRequestException();
        return Promise.resolve({ id, milestone: dto.milestone });
      }),
      bulkModify: jest.fn().mockResolvedValue({ updated: 3 }),
      selfAllocate: jest.fn().mockResolvedValue({ allocated: 2 }),
      bulkDelete: jest.fn().mockResolvedValue({ deleted: 2 }),
      getColumns: jest.fn().mockReturnValue({ columns: [] }),
      saveColumns: jest.fn().mockReturnValue({ columns: [{ key: 'worklistNumber', visible: true }] }),
      addFeedback: jest.fn().mockResolvedValue({ id: 8001 }),
    };
    const built = await buildTestApp({ controllers: [ChartsController], providers: [{ provide: ChartsService, useValue: svc }] });
    app = built.app; moduleRef = built.moduleRef;
  });
  afterAll(async () => { await app.close(); });

  it('TC-CHART-001: GET /charts as CODER returns 200', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/charts').set(bearer(asCoder(moduleRef)));
    expect(res.status).toBe(200);
  });
  it('TC-CHART-002: GET /charts filtered by priority', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/charts').query({ priority: 'HIGH' }).set(bearer(asCoder(moduleRef)));
    expect(res.status).toBe(200);
  });
  it('TC-CHART-003: GET /charts filtered by milestone', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/charts').query({ milestone: 'READY_TO_CODE' }).set(bearer(asCoder(moduleRef)));
    expect(res.status).toBe(200);
  });
  it('TC-CHART-004: GET /charts/summary returns counters', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/charts/summary').set(bearer(asCoder(moduleRef)));
    expect(res.status).toBe(200);
    expect(res.body.priorityCounts.high).toBe(31);
  });
  it('TC-CHART-005: GET /charts/:id returns detail', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/charts/55001').set(bearer(asCoder(moduleRef)));
    expect(res.status).toBe(200);
  });
  it('TC-CHART-006: GET /charts/:id not found returns 404', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/charts/999').set(bearer(asCoder(moduleRef)));
    expect(res.status).toBe(404);
  });
  it('TC-CHART-007: PATCH /charts/:id as CODER', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/charts/55001').set(bearer(asCoder(moduleRef))).send({ primaryDiagnosis: 'R07.9' });
    expect(res.status).toBe(200);
  });
  it('TC-CHART-008: PATCH /charts/:id as AUDITOR', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/charts/55001').set(bearer(asAuditor(moduleRef))).send({ primaryDiagnosis: 'R07.9' });
    expect(res.status).toBe(200);
  });
  it('TC-CHART-009: POST /charts/:id/start returns 200', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/charts/55001/start').set(bearer(asCoder(moduleRef)));
    expect(res.status).toBe(200);
  });
  it('TC-CHART-010: POST /charts/:id/stop returns 200', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/charts/55001/stop').set(bearer(asCoder(moduleRef)));
    expect(res.status).toBe(200);
  });
  it('TC-CHART-011: POST /charts/:id/transition valid', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/charts/55001/transition').set(bearer(asCoder(moduleRef)))
      .send({ milestone: 'CODING_DONE', chartStatus: 'COMPLETE' });
    expect(res.status).toBe(200);
  });
  it('TC-CHART-012: POST /charts/:id/transition invalid returns 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/charts/55001/transition').set(bearer(asCoder(moduleRef)))
      .send({ milestone: 'BAD_STATE' });
    expect([400, 422]).toContain(res.status);
  });
  it('TC-CHART-013: POST /charts/bulk/modify as MANAGER', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/charts/bulk/modify').set(bearer(asManager(moduleRef)))
      .send({ chartIds: [1, 2, 3], priority: 'HIGH' });
    expect(res.status).toBe(201);
  });
  it('TC-CHART-014: POST /charts/bulk/modify as CODER returns 403', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/charts/bulk/modify').set(bearer(asCoder(moduleRef)))
      .send({ chartIds: [1], priority: 'HIGH' });
    expect(res.status).toBe(403);
  });
  it('TC-CHART-015: POST /charts/bulk/self-allocate as CODER', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/charts/bulk/self-allocate').set(bearer(asCoder(moduleRef)))
      .send({ chartIds: [1, 2] });
    expect(res.status).toBe(201);
  });
  it('TC-CHART-016: POST /charts/bulk/self-allocate as MANAGER returns 403', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/charts/bulk/self-allocate').set(bearer(asManager(moduleRef)))
      .send({ chartIds: [1] });
    expect(res.status).toBe(403);
  });
  it('TC-CHART-017: DELETE /charts/bulk as MANAGER', async () => {
    const res = await request(app.getHttpServer())
      .delete('/api/v1/charts/bulk').set(bearer(asManager(moduleRef))).send({ chartIds: [1, 2] });
    expect(res.status).toBe(200);
  });
  it('TC-CHART-018: GET /charts/columns', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/charts/columns').set(bearer(asCoder(moduleRef)));
    expect(res.status).toBe(200);
  });
  it('TC-CHART-019: PUT /charts/columns', async () => {
    const res = await request(app.getHttpServer())
      .put('/api/v1/charts/columns').set(bearer(asCoder(moduleRef)))
      .send({ columns: [{ key: 'worklistNumber', visible: true }] });
    expect(res.status).toBe(200);
  });
  it('TC-CHART-020: POST /charts/:id/feedback as AUDITOR', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/charts/55001/feedback').set(bearer(asAuditor(moduleRef)))
      .send({ categoryId: 17, feedbackTypeId: 42, feedbackStatus: 'Feedback Provided', comments: 'ok' });
    expect(res.status).toBe(201);
  });
});

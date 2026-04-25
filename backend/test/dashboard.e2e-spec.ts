/**
 * Dashboard (e2e) — covers TC-DASH-001 … TC-DASH-010
 */
import { INestApplication } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { DashboardController } from '../src/modules/dashboard/dashboard.controller';
import { DashboardService } from '../src/modules/dashboard/dashboard.service';
import { buildTestApp } from './helpers/app-factory';
import { asCoder, asAuditor, asManager, bearer } from './helpers/auth-helpers';

describe('Dashboard (e2e)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let svc: jest.Mocked<Partial<DashboardService>>;

  beforeAll(async () => {
    svc = {
      milestones: jest.fn().mockResolvedValue({ inProgress: 4, readyToCode: 2470, readyToAllocate: 1724 }),
      status: jest.fn().mockResolvedValue({ complete: 7369, incomplete: 1072 }),
      unallocated: jest.fn().mockResolvedValue({ worklists: { unallocated: 74, total: 442 }, charts: { unallocated: 1724, total: 12001 } }),
      allocationStats: jest.fn().mockResolvedValue({ chartsByMilestone: [{ milestone: 'READY_TO_CODE', count: 8 }] }),
      self: jest.fn().mockResolvedValue({ readyToCode: 2470, codingDoneToday: 0 }),
    };
    const built = await buildTestApp({ controllers: [DashboardController], providers: [{ provide: DashboardService, useValue: svc }] });
    app = built.app; moduleRef = built.moduleRef;
  });
  afterAll(async () => { await app.close(); });

  it('TC-DASH-001: GET /dashboard/milestones as CODER returns 200', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/dashboard/milestones').set(bearer(asCoder(moduleRef)));
    expect(res.status).toBe(200);
    expect(res.body.readyToCode).toBe(2470);
  });

  it('TC-DASH-002: GET /dashboard/milestones without token returns 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/dashboard/milestones');
    expect(res.status).toBe(401);
  });

  it('TC-DASH-003: GET /dashboard/status as MANAGER returns 200', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/dashboard/status').set(bearer(asManager(moduleRef)));
    expect(res.status).toBe(200);
    expect(res.body.complete).toBe(7369);
  });

  it('TC-DASH-004: GET /dashboard/unallocated as MANAGER returns 200', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/dashboard/unallocated').set(bearer(asManager(moduleRef)));
    expect(res.status).toBe(200);
    expect(res.body.charts.total).toBe(12001);
  });

  it('TC-DASH-005: GET /dashboard/unallocated as CODER returns 403', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/dashboard/unallocated').set(bearer(asCoder(moduleRef)));
    expect(res.status).toBe(403);
  });

  it('TC-DASH-006: GET /dashboard/allocation-stats as MANAGER returns 200', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/dashboard/allocation-stats').set(bearer(asManager(moduleRef)));
    expect(res.status).toBe(200);
  });

  it('TC-DASH-007: GET /dashboard/allocation-stats as CODER returns 403', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/dashboard/allocation-stats').set(bearer(asCoder(moduleRef)));
    expect(res.status).toBe(403);
  });

  it('TC-DASH-008: GET /dashboard/self as CODER returns 200', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/dashboard/self').set(bearer(asCoder(moduleRef)));
    expect(res.status).toBe(200);
  });

  it('TC-DASH-009: GET /dashboard/self as AUDITOR returns 200', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/dashboard/self').set(bearer(asAuditor(moduleRef)));
    expect(res.status).toBe(200);
  });

  it('TC-DASH-010: GET /dashboard/milestones with clientId filter returns 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/dashboard/milestones').query({ clientId: 7 }).set(bearer(asManager(moduleRef)));
    expect(res.status).toBe(200);
  });
});

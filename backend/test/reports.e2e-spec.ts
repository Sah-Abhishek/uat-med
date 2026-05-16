/**
 * Reports (e2e) — covers TC-RPT-001 … TC-RPT-010
 */
import { INestApplication } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { ReportsController } from '../src/modules/reports/reports.controller';
import { ReportsService } from '../src/modules/reports/reports.service';
import { buildTestApp } from './helpers/app-factory';
import { asManager, bearer } from './helpers/auth-helpers';

describe('Reports (e2e)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let svc: jest.Mocked<Partial<ReportsService>>;

  beforeAll(async () => {
    svc = {
      fields: jest.fn().mockReturnValue([{ key: 'worklistNumber', label: 'Worklist Number' }]),
      runQuery: jest.fn().mockResolvedValue({ columns: ['worklistNumber'], rows: [['19309A']], total: 1, page: 1, pageSize: 50 }),
      listTemplates: jest.fn().mockResolvedValue({ items: [{ id: 11, name: 'Weekly' }], total: 1, page: 1, pageSize: 20 }),
      createTemplate: jest.fn().mockResolvedValue({ id: 14 }),
      getTemplate: jest.fn().mockResolvedValue({ id: 14, name: 'Weekly', columns: ['worklistNumber'], filters: {} }),
      updateTemplate: jest.fn().mockResolvedValue({ id: 14 }),
      deleteTemplate: jest.fn().mockResolvedValue({ status: 'deleted' }),
      exportToExcel: jest.fn().mockResolvedValue(Buffer.from('PK')),
    };
    const built = await buildTestApp({ controllers: [ReportsController], providers: [{ provide: ReportsService, useValue: svc }] });
    app = built.app; moduleRef = built.moduleRef;
  });
  afterAll(async () => { await app.close(); });

  it('TC-RPT-001: GET /reports/fields', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/reports/fields').set(bearer(asManager(moduleRef)));
    expect(res.status).toBe(200);
  });
  it('TC-RPT-002: POST /reports/query', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/reports/query').set(bearer(asManager(moduleRef)))
      .send({ columns: ['worklistNumber'], filters: { client: 7 } });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });
  it('TC-RPT-003: POST /reports/query missing columns returns 422', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/reports/query').set(bearer(asManager(moduleRef))).send({});
    expect([400, 422]).toContain(res.status);
  });
  it('TC-RPT-004: POST /reports/templates', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/reports/templates').set(bearer(asManager(moduleRef)))
      .send({ name: 'Weekly', columns: ['worklistNumber'] });
    expect(res.status).toBe(201);
  });
  it('TC-RPT-005: GET /reports/templates', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/reports/templates').set(bearer(asManager(moduleRef)));
    expect(res.status).toBe(200);
  });
  it('TC-RPT-006: GET /reports/templates/:id', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/reports/templates/14').set(bearer(asManager(moduleRef)));
    expect(res.status).toBe(200);
  });
  it('TC-RPT-007: PUT /reports/templates/:id', async () => {
    const res = await request(app.getHttpServer())
      .put('/api/v1/reports/templates/14').set(bearer(asManager(moduleRef)))
      .send({ name: 'Weekly v2', columns: ['worklistNumber'] });
    expect(res.status).toBe(200);
  });
  it('TC-RPT-008: DELETE /reports/templates/:id', async () => {
    const res = await request(app.getHttpServer()).delete('/api/v1/reports/templates/14').set(bearer(asManager(moduleRef)));
    expect(res.status).toBe(200);
  });
  it('TC-RPT-009: POST /reports/export.xlsx streams an xlsx attachment', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/reports/export.xlsx').set(bearer(asManager(moduleRef)))
      .send({ columns: ['worklistNumber'] });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('attachment');
  });
});

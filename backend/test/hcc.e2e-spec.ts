/**
 * HCC (e2e) — covers TC-HCC-001 … TC-HCC-012
 */
import { INestApplication, NotFoundException } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { HccController } from '../src/modules/hcc/hcc.controller';
import { HccService } from '../src/modules/hcc/hcc.service';
import { buildTestApp } from './helpers/app-factory';
import { asCoder, asManager, bearer } from './helpers/auth-helpers';

describe('HCC (e2e)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let svc: jest.Mocked<Partial<HccService>>;

  beforeAll(async () => {
    svc = {
      list: jest.fn().mockResolvedValue({ items: [{ id: 9001, memberId: '9991' }], total: 1, page: 1, pageSize: 20 }),
      create: jest.fn().mockResolvedValue({ id: 9001 }),
      saveAndNext: jest.fn().mockResolvedValue({ saved: { id: 9001 }, nextTemplate: { memberId: '9991' } }),
      detail: jest.fn().mockImplementation((id: number) => {
        if (id === 999) throw new NotFoundException();
        return Promise.resolve({ id, memberId: '9991' });
      }),
      update: jest.fn().mockResolvedValue({ id: 9001 }),
      remove: jest.fn().mockResolvedValue({ status: 'deleted' }),
      fields: jest.fn().mockReturnValue([{ name: 'Smoking Status', type: 'dropdown' }]),
    };
    const built = await buildTestApp({ controllers: [HccController], providers: [{ provide: HccService, useValue: svc }] });
    app = built.app; moduleRef = built.moduleRef;
  });
  afterAll(async () => { await app.close(); });

  it('TC-HCC-001: GET /hcc/records as CODER returns 200', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/hcc/records').set(bearer(asCoder(moduleRef)));
    expect(res.status).toBe(200);
  });
  it('TC-HCC-002: GET /hcc/records with pagination', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/hcc/records').query({ page: 1, pageSize: 5 }).set(bearer(asCoder(moduleRef)));
    expect(res.status).toBe(200);
  });
  it('TC-HCC-003: POST /hcc/records as CODER returns 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/hcc/records').set(bearer(asCoder(moduleRef)))
      .send({ memberId: '9991', memberName: 'K', dob: '1965-07-15', dos: '2025-06-11', validate: 'ADD' });
    expect(res.status).toBe(201);
  });
  it('TC-HCC-004: POST /hcc/records missing required returns 422', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/hcc/records').set(bearer(asCoder(moduleRef))).send({});
    expect([400, 422]).toContain(res.status);
  });
  it('TC-HCC-005: POST /hcc/records/save-and-next returns 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/hcc/records/save-and-next').set(bearer(asCoder(moduleRef)))
      .send({ memberId: '9991', memberName: 'K' });
    expect(res.status).toBe(201);
    expect(res.body.saved.id).toBe(9001);
  });
  it('TC-HCC-006: GET /hcc/records/:id returns detail', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/hcc/records/9001').set(bearer(asCoder(moduleRef)));
    expect(res.status).toBe(200);
  });
  it('TC-HCC-007: PATCH /hcc/records/:id updates', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/hcc/records/9001').set(bearer(asCoder(moduleRef))).send({ reviewerNote: 'Updated' });
    expect(res.status).toBe(200);
  });
  it('TC-HCC-008: DELETE /hcc/records/:id as MANAGER', async () => {
    const res = await request(app.getHttpServer()).delete('/api/v1/hcc/records/9001').set(bearer(asManager(moduleRef)));
    expect(res.status).toBe(200);
  });
  it('TC-HCC-009: DELETE /hcc/records/:id as CODER returns 403', async () => {
    const res = await request(app.getHttpServer()).delete('/api/v1/hcc/records/9001').set(bearer(asCoder(moduleRef)));
    expect(res.status).toBe(403);
  });
  it('TC-HCC-010: GET /hcc/fields returns catalog', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/hcc/fields').set(bearer(asCoder(moduleRef)));
    expect(res.status).toBe(200);
  });
  it('TC-HCC-011: GET /hcc/records without token returns 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/hcc/records');
    expect(res.status).toBe(401);
  });
  it('TC-HCC-012: GET /hcc/records/:id not found returns 404', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/hcc/records/999').set(bearer(asCoder(moduleRef)));
    expect(res.status).toBe(404);
  });
});

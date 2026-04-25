/**
 * Configurations (e2e) — covers TC-CFG-001 … TC-CFG-012
 */
import { INestApplication } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { ConfigurationsController } from '../src/modules/configurations/configurations.controller';
import { ConfigurationsService } from '../src/modules/configurations/configurations.service';
import { buildTestApp } from './helpers/app-factory';
import { asAdmin, asManager, asCoder, bearer } from './helpers/auth-helpers';

describe('Configurations (e2e)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    const built = await buildTestApp({
      controllers: [ConfigurationsController],
      providers: [ConfigurationsService], // real in-memory service
    });
    app = built.app; moduleRef = built.moduleRef;
  });
  afterAll(async () => { await app.close(); });

  it('TC-CFG-001: GET /configurations/general as MANAGER', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/configurations/general').set(bearer(asManager(moduleRef)));
    expect(res.status).toBe(200);
  });
  it('TC-CFG-002: GET /configurations/general as CODER returns 403', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/configurations/general').set(bearer(asCoder(moduleRef)));
    expect(res.status).toBe(403);
  });
  it('TC-CFG-003: PUT /configurations/general as ADMIN', async () => {
    const res = await request(app.getHttpServer())
      .put('/api/v1/configurations/general').set(bearer(asAdmin(moduleRef))).send({ defaultPageSize: 50 });
    expect(res.status).toBe(200);
  });
  it('TC-CFG-004: PUT /configurations/general as MANAGER returns 403', async () => {
    const res = await request(app.getHttpServer())
      .put('/api/v1/configurations/general').set(bearer(asManager(moduleRef))).send({ defaultPageSize: 50 });
    expect(res.status).toBe(403);
  });
  it('TC-CFG-005: POST /configurations/clients as ADMIN', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/configurations/clients').set(bearer(asAdmin(moduleRef)))
      .send({ name: 'Client A', code: 'CA' });
    expect(res.status).toBe(201);
  });
  it('TC-CFG-006: GET /configurations/locations', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/configurations/locations').query({ clientId: 1 }).set(bearer(asManager(moduleRef)));
    expect(res.status).toBe(200);
  });
  it('TC-CFG-007: POST /configurations/locations as ADMIN', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/configurations/locations').set(bearer(asAdmin(moduleRef)))
      .send({ clientId: 1, name: 'Loc A' });
    expect(res.status).toBe(201);
  });
  it('TC-CFG-008: GET /configurations/specialities/chart-fields', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/configurations/specialities/chart-fields').set(bearer(asManager(moduleRef)));
    expect(res.status).toBe(200);
  });
  it('TC-CFG-009: POST /configurations/specialities/chart-fields/custom', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/configurations/specialities/chart-fields/custom').set(bearer(asAdmin(moduleRef)))
      .send({ name: 'Custom Field', type: 'dropdown', options: ['A', 'B'] });
    expect(res.status).toBe(201);
  });
  it('TC-CFG-010: DELETE /configurations/specialities/chart-fields/custom/:id', async () => {
    // seed one first
    const created = await request(app.getHttpServer())
      .post('/api/v1/configurations/specialities/chart-fields/custom').set(bearer(asAdmin(moduleRef)))
      .send({ name: 'Ephemeral', type: 'text' });
    const res = await request(app.getHttpServer())
      .delete(`/api/v1/configurations/specialities/chart-fields/custom/${created.body.id}`)
      .set(bearer(asAdmin(moduleRef)));
    expect(res.status).toBe(200);
  });
  it('TC-CFG-011: GET /configurations/hcc/fields', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/configurations/hcc/fields').set(bearer(asManager(moduleRef)));
    expect(res.status).toBe(200);
  });
  it('TC-CFG-012: POST /configurations/hcc/fields', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/configurations/hcc/fields').set(bearer(asAdmin(moduleRef)))
      .send({ name: 'Smoking Status', type: 'dropdown', isMultiSelect: true, preserveNext: true, options: ['Y', 'N'] });
    expect(res.status).toBe(201);
  });
});

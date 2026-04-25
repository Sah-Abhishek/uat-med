import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from '../../entities/client.entity';
import { Location } from '../../entities/location.entity';

/**
 * Configurations service.
 *
 * Clients and Locations are PERSISTED via TypeORM (they're referenced by FKs
 * from the users table, so they MUST exist in the database — otherwise user
 * creation throws a FK violation).
 *
 * The remaining configs (specialities breakdown, feedback categories, auditing,
 * coding, chart fields, HCC fields) are still in-memory stubs with correct
 * shapes. Migrate them to TypeORM-backed repositories in a follow-up once
 * the data model is finalized.
 *
 * IMPORTANT: Every array-returning method returns `[]` instead of `null` or
 * `undefined` when there's no data — the frontend crashes on missing arrays.
 */
@Injectable()
export class ConfigurationsService {
  constructor(
    @InjectRepository(Client) private readonly clientsRepo: Repository<Client>,
    @InjectRepository(Location) private readonly locationsRepo: Repository<Location>,
  ) {}

  /* ── General settings (in-memory) ─────────────────────── */
  private generalSettings = {
    chartListViewDays: 30,
    defaultPageSize: 20,
    allowSelfAllocation: true,
    autoCloseCompletedAfterDays: 7,
    timezone: 'Asia/Kolkata',
  };

  general() {
    return this.generalSettings;
  }

  updateGeneral(body: Record<string, any>) {
    this.generalSettings = { ...this.generalSettings, ...body };
    return this.generalSettings;
  }

  /* ── Clients (TypeORM-backed) ─────────────────────────── */

  async listClients() {
    const rows = await this.clientsRepo.find({
      order: { name: 'ASC' },
      relations: ['locations'],
    }).catch(() => this.clientsRepo.find({ order: { name: 'ASC' } }));

    const items = rows.map((c) => ({
      id: c.id,
      name: c.name,
      code: c.code ?? '',
      isActive: c.isActive ?? true,
      locations: (c as any).locations ?? [],
    }));
    return { items };
  }

  async createClient(body: { name: string; code?: string; isActive?: boolean }) {
    const client = this.clientsRepo.create({
      name: body.name,
      code: body.code ?? '',
      isActive: body.isActive ?? true,
    });
    const saved = await this.clientsRepo.save(client);
    return { id: saved.id };
  }

  /* ── Locations (TypeORM-backed) ───────────────────────── */

  async listLocations(clientId: number) {
    const rows = await this.locationsRepo.find({
      where: { clientId },
      order: { name: 'ASC' },
    });
    const items = rows.map((l) => ({
      id: l.id,
      clientId: l.clientId,
      name: l.name,
      code: l.code ?? '',
      isActive: l.isActive ?? true,
    }));
    return { items };
  }

  async createLocation(body: {
    clientId: number;
    name: string;
    code?: string;
    isActive?: boolean;
  }) {
    // Sanity check: the client must exist — otherwise the FK on Location itself will reject
    const client = await this.clientsRepo.findOne({ where: { id: body.clientId } });
    if (!client) {
      throw new NotFoundException({
        error: { code: 'not_found', message: `Client ${body.clientId} not found.` },
      });
    }

    const loc = this.locationsRepo.create({
      clientId: body.clientId,
      name: body.name,
      code: body.code ?? '',
      isActive: body.isActive ?? true,
    });
    const saved = await this.locationsRepo.save(loc);
    return { id: saved.id };
  }

  /* ── Specialities → General (stub) ────────────────────── */

  private specialitiesGeneralState = {
    primarySpecialities: [{ id: 3, name: 'ED', isActive: true }],
    subSpecialities: [{ id: 8, name: 'Trauma', primarySpecialityId: 3, isActive: true }],
    processes: [{ id: 1, name: 'Coding', isActive: true }],
    facilities: [{ id: 2, name: 'TRH Main', isActive: true }],
    designations: [{ id: 4, name: 'Sr. Coder', isActive: true }],
  };

  specialitiesGeneral() {
    return {
      primarySpecialities: this.specialitiesGeneralState.primarySpecialities ?? [],
      subSpecialities: this.specialitiesGeneralState.subSpecialities ?? [],
      processes: this.specialitiesGeneralState.processes ?? [],
      facilities: this.specialitiesGeneralState.facilities ?? [],
      designations: this.specialitiesGeneralState.designations ?? [],
    };
  }

  updateSpecialitiesGeneral(body: any) {
    this.specialitiesGeneralState = {
      primarySpecialities: body?.primarySpecialities ?? [],
      subSpecialities: body?.subSpecialities ?? [],
      processes: body?.processes ?? [],
      facilities: body?.facilities ?? [],
      designations: body?.designations ?? [],
    };
    return this.specialitiesGeneralState;
  }

  /* ── Feedback Categories (stub) ───────────────────────── */
  // Frontend expects `{ groups: [{ area, categories: [{ name, types: [{ name }] }] }] }`
  // with one group per audit area. Seed it with reasonable defaults.

  private feedbackGroups = [
    {
      area: 'Primary Diagnosis',
      categories: [
        { id: 17, name: 'Primary Diagnosis', types: [
          { id: 42, name: 'Incorrect code' },
          { id: 43, name: 'Missing code' },
        ] },
      ],
    },
    { area: 'Secondary Diagnosis', categories: [] },
    { area: 'Procedures', categories: [] },
    { area: 'ED/EM Level', categories: [] },
    { area: 'Modifier', categories: [] },
    { area: 'POA Indicator', categories: [] },
    { area: 'Drug Value', categories: [] },
  ];

  feedbackCategories() {
    return { groups: this.feedbackGroups ?? [] };
  }

  updateFeedbackCategories(body: any) {
    this.feedbackGroups = body?.groups ?? [];
    return { groups: this.feedbackGroups };
  }

  copyFeedbackCategories(_body: any) {
    return { status: 'ok' };
  }

  /* ── Auditing (stub) ──────────────────────────────────── */
  // Frontend expects `{ auditOptions: [], feedbackTypes: [] }` — the missing
  // `feedbackTypes` field was what caused the original runtime crash.

  private auditingState = {
    auditOptions: [
      { id: 11, name: 'Agree' },
      { id: 12, name: 'Rejected' },
    ],
    feedbackTypes: [] as Array<{ id?: number; name: string }>,
  };

  auditing() {
    return {
      auditOptions: this.auditingState.auditOptions ?? [],
      feedbackTypes: this.auditingState.feedbackTypes ?? [],
    };
  }

  updateAuditing(body: any) {
    this.auditingState = {
      auditOptions: body?.auditOptions ?? [],
      feedbackTypes: body?.feedbackTypes ?? [],
    };
    return this.auditingState;
  }

  /* ── Coding (stub) ────────────────────────────────────── */

  private codingState = {
    holdReasons: [{ id: 21, name: 'Missing Documentation' }],
    responsibleParties: [{ id: 31, name: 'Client' }],
    dispositions: [{ id: 41, name: 'Final' }],
    primaryHealthPlans: [{ id: 51, name: 'CarePlus' }],
  };

  coding() {
    return {
      holdReasons: this.codingState.holdReasons ?? [],
      responsibleParties: this.codingState.responsibleParties ?? [],
      dispositions: this.codingState.dispositions ?? [],
      primaryHealthPlans: this.codingState.primaryHealthPlans ?? [],
    };
  }

  updateCoding(body: any) {
    this.codingState = {
      holdReasons: body?.holdReasons ?? [],
      responsibleParties: body?.responsibleParties ?? [],
      dispositions: body?.dispositions ?? [],
      primaryHealthPlans: body?.primaryHealthPlans ?? [],
    };
    return this.codingState;
  }

  /* ── Chart Fields (stub) ──────────────────────────────── */

  private customChartFields: any[] = [];
  private standardChartFields: Array<{ key: string; validation: string }> = [
    { key: 'chartNo', validation: 'MANDATORY' },
    { key: 'mrNumber', validation: 'NON_MANDATORY' },
    { key: 'dos', validation: 'MANDATORY' },
    { key: 'dischargeDate', validation: 'NON_MANDATORY' },
  ];

  chartFields() {
    return {
      standardFields: this.standardChartFields ?? [],
      customFields: this.customChartFields ?? [],
    };
  }

  updateChartFields(body: any) {
    this.standardChartFields = body?.standardFields ?? [];
    if (Array.isArray(body?.customFields)) {
      this.customChartFields = body.customFields;
    }
    return this.chartFields();
  }

  createCustomChartField(body: any) {
    const id = (this.customChartFields.at(-1)?.id ?? 100) + 1;
    this.customChartFields.push({ id, ...body });
    return { id };
  }

  updateCustomChartField(id: number, body: any) {
    const idx = this.customChartFields.findIndex((f) => f.id === id);
    if (idx < 0) throw new NotFoundException();
    this.customChartFields[idx] = { ...this.customChartFields[idx], ...body };
    return this.customChartFields[idx];
  }

  deleteCustomChartField(id: number) {
    this.customChartFields = this.customChartFields.filter((f) => f.id !== id);
    return { status: 'deleted' };
  }

  /* ── HCC Fields (stub) ────────────────────────────────── */

  private customHccFields: any[] = [
    {
      id: 81,
      name: 'Smoking Status',
      type: 'dropdown',
      isMultiSelect: true,
      validation: 'MANDATORY',
      preserveNext: true,
      options: ['Smoker', 'Non Smoker', 'Quit Smoking'],
    },
  ];

  hccFields() {
    return this.customHccFields ?? [];
  }

  createHccField(body: any) {
    const id = (this.customHccFields.at(-1)?.id ?? 100) + 1;
    this.customHccFields.push({ id, ...body });
    return { id };
  }

  updateHccField(id: number, body: any) {
    const idx = this.customHccFields.findIndex((f) => f.id === id);
    if (idx < 0) throw new NotFoundException();
    this.customHccFields[idx] = { ...this.customHccFields[idx], ...body };
    return this.customHccFields[idx];
  }

  deleteHccField(id: number) {
    this.customHccFields = this.customHccFields.filter((f) => f.id !== id);
    return { status: 'deleted' };
  }
}
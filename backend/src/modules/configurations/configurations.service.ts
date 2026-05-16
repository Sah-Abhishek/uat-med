import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { CodeReviewAction, CodeReviewType } from '../../common/enums';
import { CodeReviewReason } from '../../entities/code-review-reason.entity';
import { Client } from '../../entities/client.entity';
import { Location } from '../../entities/location.entity';
import { PrimarySpeciality } from '../../entities/primary-speciality.entity';
import { SubSpeciality } from '../../entities/sub-speciality.entity';
import { Process } from '../../entities/process.entity';
import { Facility } from '../../entities/facility.entity';
import { HoldReason } from '../../entities/hold-reason.entity';
import { ResponsibleParty } from '../../entities/responsible-party.entity';
import { Disposition } from '../../entities/disposition.entity';
import { PrimaryHealthPlan } from '../../entities/primary-health-plan.entity';
import { AuditOption } from '../../entities/audit-option.entity';
import { FeedbackType } from '../../entities/feedback-type.entity';
import { AuditArea } from '../../entities/audit-area.entity';
import { AuditFeedbackReason } from '../../entities/audit-feedback-reason.entity';
import { StandardFieldConfig } from '../../entities/standard-field-config.entity';
import { CustomFieldConfig } from '../../entities/custom-field-config.entity';

const BUILTIN_AUDIT_AREAS = [
  'Primary Diagnosis',
  'Secondary Diagnosis',
  'Procedures',
  'ED/EM Level',
  'Modifier',
  'POA Indicator',
  'DRG Value',
];

export interface NamedRow { id?: number; name: string; isActive?: boolean }
export interface SpecialitiesGeneralBody {
  primarySpecialities?: NamedRow[];
  subSpecialities?: NamedRow[];
  processes?: NamedRow[];
  facilities?: NamedRow[];
  designations?: NamedRow[];
  doesSupportProcessWiseCoding?: boolean;
}
export interface CodingBody {
  holdReasons?: NamedRow[];
  responsibleParties?: NamedRow[];
  dispositions?: NamedRow[];
  primaryHealthPlans?: NamedRow[];
}
export interface AuditingBody {
  auditOptions?: NamedRow[];
  feedbackTypes?: NamedRow[];
}

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
    @InjectRepository(PrimarySpeciality) private readonly primarySpecsRepo: Repository<PrimarySpeciality>,
    @InjectRepository(SubSpeciality) private readonly subSpecsRepo: Repository<SubSpeciality>,
    @InjectRepository(Process) private readonly processesRepo: Repository<Process>,
    @InjectRepository(Facility) private readonly facilitiesRepo: Repository<Facility>,
    @InjectRepository(HoldReason) private readonly holdReasonsRepo: Repository<HoldReason>,
    @InjectRepository(ResponsibleParty) private readonly responsiblePartiesRepo: Repository<ResponsibleParty>,
    @InjectRepository(Disposition) private readonly dispositionsRepo: Repository<Disposition>,
    @InjectRepository(PrimaryHealthPlan) private readonly primaryHealthPlansRepo: Repository<PrimaryHealthPlan>,
    @InjectRepository(AuditOption) private readonly auditOptionsRepo: Repository<AuditOption>,
    @InjectRepository(FeedbackType) private readonly feedbackTypesRepo: Repository<FeedbackType>,
    @InjectRepository(AuditArea) private readonly auditAreasRepo: Repository<AuditArea>,
    @InjectRepository(AuditFeedbackReason) private readonly auditReasonsRepo: Repository<AuditFeedbackReason>,
    @InjectRepository(StandardFieldConfig) private readonly stdFieldsRepo: Repository<StandardFieldConfig>,
    @InjectRepository(CustomFieldConfig) private readonly customFieldsRepo: Repository<CustomFieldConfig>,
    @InjectRepository(CodeReviewReason) private readonly codeReviewReasonsRepo: Repository<CodeReviewReason>,
    private readonly dataSource: DataSource,
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

  /* ── Specialities → General (DB-backed) ───────────────── */

  // Designations are not yet a real entity — kept as in-memory for now.
  private designationsState: NamedRow[] = [{ id: 4, name: 'Sr. Coder', isActive: true }];

  /** Lightweight: primary specialities, optionally filtered to one client. */
  async listPrimarySpecialities(clientId?: number) {
    const where = clientId ? { clientId } : {};
    const rows = await this.primarySpecsRepo.find({ where, order: { id: 'ASC' } });
    return {
      items: rows.map((r) => ({ id: Number(r.id), clientId: Number(r.clientId), name: r.name })),
    };
  }

  /** Lightweight: processes for one location. */
  async listProcessesByLocation(locationId: number) {
    const rows = await this.processesRepo.find({
      where: { locationId, isActive: true },
      order: { id: 'ASC' },
    });
    return {
      items: rows.map((r) => ({ id: Number(r.id), locationId: Number(r.locationId), name: r.name })),
    };
  }

  async specialitiesGeneral(scope: { clientId?: number; locationId?: number }) {
    const { clientId, locationId } = this.requireScope(scope);
    const location = await this.requireLocation(clientId, locationId);

    const [primary, sub, processes, facilities] = await Promise.all([
      this.primarySpecsRepo.find({ where: { clientId }, order: { id: 'ASC' } }),
      this.subSpecsRepo.find({ where: { locationId }, order: { id: 'ASC' } }),
      this.processesRepo.find({ where: { locationId }, order: { id: 'ASC' } }),
      this.facilitiesRepo.find({ where: { locationId }, order: { id: 'ASC' } }),
    ]);

    return {
      primarySpecialities: primary.map((r) => ({ id: Number(r.id), name: r.name, isActive: r.isActive })),
      subSpecialities: sub.map((r) => ({ id: Number(r.id), name: r.name, isActive: r.isActive })),
      processes: processes.map((r) => ({ id: Number(r.id), name: r.name, isActive: r.isActive })),
      facilities: facilities.map((r) => ({ id: Number(r.id), name: r.name, isActive: r.isActive })),
      designations: this.designationsState,
      doesSupportProcessWiseCoding: location.doesSupportProcessWiseCoding ?? false,
    };
  }

  async updateSpecialitiesGeneral(body: SpecialitiesGeneralBody, scope: { clientId?: number; locationId?: number }) {
    const { clientId, locationId } = this.requireScope(scope);
    await this.requireLocation(clientId, locationId);

    await Promise.all([
      this.syncNamedScoped(this.primarySpecsRepo, body.primarySpecialities ?? [], 'clientId', clientId),
      this.syncNamedScoped(this.subSpecsRepo, body.subSpecialities ?? [], 'locationId', locationId),
      this.syncNamedScoped(this.processesRepo, body.processes ?? [], 'locationId', locationId),
      this.syncNamedScoped(this.facilitiesRepo, body.facilities ?? [], 'locationId', locationId),
    ]);

    if (typeof body.doesSupportProcessWiseCoding === 'boolean') {
      await this.locationsRepo.update(
        { id: locationId },
        { doesSupportProcessWiseCoding: body.doesSupportProcessWiseCoding },
      );
    }
    if (Array.isArray(body.designations)) this.designationsState = body.designations;

    return this.specialitiesGeneral({ clientId, locationId });
  }

  private requireScope(scope: { clientId?: number; locationId?: number }) {
    const clientId = Number(scope.clientId);
    const locationId = Number(scope.locationId);
    if (!clientId || !locationId) {
      throw new BadRequestException({
        error: { code: 'invalid_argument', message: 'clientId and locationId are required.' },
      });
    }
    return { clientId, locationId };
  }

  private async requireLocation(clientId: number, locationId: number): Promise<Location> {
    const loc = await this.locationsRepo.findOne({ where: { id: locationId, clientId } });
    if (!loc) {
      throw new NotFoundException({
        error: { code: 'not_found', message: `Location ${locationId} does not belong to client ${clientId}.` },
      });
    }
    return loc;
  }

  /**
   * Diff-based sync for `(id, name, <scopeCol>)` rows.
   *
   * Preserves IDs across renames so charts that reference these IDs stay valid.
   * Hard-deletes rows that disappear from the incoming payload — fine while no
   * tables FK to these yet; switch to soft-delete once they do.
   */
  private async syncNamedScoped<T extends { id: number; name: string; isActive: boolean }>(
    repo: Repository<T>,
    incoming: NamedRow[],
    scopeCol: 'clientId' | 'locationId',
    scopeValue: number,
  ) {
    const existing = (await repo.find({ where: { [scopeCol]: scopeValue } as any })) as Array<T>;
    const incomingIds = incoming.filter((r) => typeof r.id === 'number').map((r) => Number(r.id));

    // Delete rows that are no longer in the payload
    const deletable = existing.filter((e) => !incomingIds.includes(Number(e.id)));
    if (deletable.length) {
      await repo.delete({ id: In(deletable.map((d) => d.id)) } as any);
    }

    for (const row of incoming) {
      const name = (row.name ?? '').trim();
      if (!name) continue;
      const isActive = row.isActive ?? true;
      if (typeof row.id === 'number') {
        // Update existing — but only if it actually belongs to this scope
        await repo.update(
          { id: row.id, [scopeCol]: scopeValue } as any,
          { name, isActive } as any,
        );
      } else {
        // Insert new
        await repo.save(repo.create({ name, isActive, [scopeCol]: scopeValue } as any));
      }
    }
  }

  /* ── Feedback Categories (DB-backed, two-level) ───────── */

  /** Lazily seed the 7 built-in audit areas if missing for this location. */
  private async ensureBuiltinAuditAreas(locationId: number) {
    let existing = await this.auditAreasRepo.find({ where: { locationId } });

    // Migrate legacy seed name: "Drug Value" was renamed to "DRG Value" to
    // match the chart-side label. Rename in place when the new name is free;
    // otherwise drop the legacy row so the unique (location, name) index holds.
    const legacy = existing.find((a) => a.name === 'Drug Value');
    if (legacy) {
      const collision = existing.find((a) => a.name === 'DRG Value');
      if (collision) {
        await this.auditReasonsRepo.delete({ auditAreaId: legacy.id });
        await this.auditAreasRepo.delete({ id: legacy.id });
      } else {
        await this.auditAreasRepo.update({ id: legacy.id }, { name: 'DRG Value' });
      }
      existing = await this.auditAreasRepo.find({ where: { locationId } });
    }

    const existingNames = new Set(existing.map((a) => a.name));
    const toCreate = BUILTIN_AUDIT_AREAS.filter((n) => !existingNames.has(n));
    if (toCreate.length === 0) return;
    await this.auditAreasRepo.save(
      toCreate.map((name) => this.auditAreasRepo.create({ locationId, name, isBuiltin: true, isSystem: false })),
    );
  }

  async feedbackCategories(scope: { clientId?: number; locationId?: number }) {
    const { clientId, locationId } = this.requireScope(scope);
    await this.requireLocation(clientId, locationId);
    await this.ensureBuiltinAuditAreas(locationId);

    const areas = await this.auditAreasRepo.find({ where: { locationId }, order: { isBuiltin: 'DESC', id: 'ASC' } });
    const reasons = await this.auditReasonsRepo.find({ where: { locationId }, order: { id: 'ASC' } });
    const reasonsByArea = new Map<number, AuditFeedbackReason[]>();
    for (const r of reasons) {
      const aid = Number(r.auditAreaId);
      if (!reasonsByArea.has(aid)) reasonsByArea.set(aid, []);
      reasonsByArea.get(aid)!.push(r);
    }

    return {
      areas: areas.map((a) => ({
        id: Number(a.id),
        name: a.name,
        isBuiltin: a.isBuiltin,
        isSystem: a.isSystem,
        reasons: (reasonsByArea.get(Number(a.id)) ?? []).map((r) => ({
          id: Number(r.id),
          name: r.name,
        })),
      })),
    };
  }

  async updateFeedbackCategories(
    body: { areas?: Array<{ id: number; reasons?: Array<{ id?: number; name: string }> }> },
    scope: { clientId?: number; locationId?: number },
  ) {
    const { clientId, locationId } = this.requireScope(scope);
    await this.requireLocation(clientId, locationId);

    for (const area of body.areas ?? []) {
      const areaId = Number(area.id);
      // Confirm the area belongs to this location (security check).
      const owned = await this.auditAreasRepo.findOne({ where: { id: areaId, locationId } });
      if (!owned) continue;

      const incoming = (area.reasons ?? []).filter((r) => (r.name ?? '').trim());
      const existing = await this.auditReasonsRepo.find({ where: { auditAreaId: areaId } });
      const incomingIds = incoming.filter((r) => typeof r.id === 'number').map((r) => Number(r.id));

      const deletable = existing.filter((e) => !incomingIds.includes(Number(e.id)));
      if (deletable.length) await this.auditReasonsRepo.delete({ id: In(deletable.map((d) => d.id)) });

      for (const r of incoming) {
        const name = (r.name ?? '').trim();
        if (typeof r.id === 'number') {
          await this.auditReasonsRepo.update({ id: r.id, auditAreaId: areaId }, { name });
        } else {
          await this.auditReasonsRepo.save(
            this.auditReasonsRepo.create({ auditAreaId: areaId, locationId, name }),
          );
        }
      }
    }

    return this.feedbackCategories({ clientId, locationId });
  }

  async createAuditArea(body: { clientId: number; locationId: number; name: string }) {
    const { clientId, locationId } = this.requireScope(body);
    await this.requireLocation(clientId, locationId);
    const name = (body.name ?? '').trim();
    if (!name) {
      throw new BadRequestException({ error: { code: 'invalid_argument', message: 'Audit area name is required.' } });
    }
    const created = await this.auditAreasRepo.save(
      this.auditAreasRepo.create({ locationId, name, isBuiltin: false, isSystem: false }),
    );
    return { id: Number(created.id) };
  }

  async deleteAuditArea(id: number, body: { clientId: number; locationId: number }) {
    const { clientId, locationId } = this.requireScope(body);
    await this.requireLocation(clientId, locationId);
    const area = await this.auditAreasRepo.findOne({ where: { id, locationId } });
    if (!area) throw new NotFoundException({ error: { code: 'not_found', message: 'Audit area not found.' } });
    if (area.isBuiltin || area.isSystem) {
      throw new BadRequestException({
        error: { code: 'invalid_argument', message: 'Built-in audit areas cannot be deleted.' },
      });
    }
    await this.auditReasonsRepo.delete({ auditAreaId: id });
    await this.auditAreasRepo.delete({ id });
    return { status: 'deleted' };
  }

  copyFeedbackCategories(_body: any) {
    // TODO: wire to real copy-from-location flow once Phase 3 lands.
    return { status: 'ok' };
  }

  /* ── Auditing (DB-backed) ─────────────────────────────── */

  async auditing(scope: { clientId?: number; locationId?: number }) {
    const { clientId, locationId } = this.requireScope(scope);
    await this.requireLocation(clientId, locationId);
    const [auditOptions, feedbackTypes] = await Promise.all([
      this.auditOptionsRepo.find({ where: { locationId }, order: { id: 'ASC' } }),
      this.feedbackTypesRepo.find({ where: { locationId }, order: { id: 'ASC' } }),
    ]);
    return {
      auditOptions: auditOptions.map((r) => ({ id: Number(r.id), name: r.name, isActive: r.isActive })),
      feedbackTypes: feedbackTypes.map((r) => ({ id: Number(r.id), name: r.name, isActive: r.isActive })),
    };
  }

  async updateAuditing(body: AuditingBody, scope: { clientId?: number; locationId?: number }) {
    const { clientId, locationId } = this.requireScope(scope);
    await this.requireLocation(clientId, locationId);
    await Promise.all([
      this.syncNamedScoped(this.auditOptionsRepo, body.auditOptions ?? [], 'locationId', locationId),
      this.syncNamedScoped(this.feedbackTypesRepo, body.feedbackTypes ?? [], 'locationId', locationId),
    ]);
    return this.auditing({ clientId, locationId });
  }

  /* ── Coding (DB-backed) ───────────────────────────────── */

  async coding(scope: { clientId?: number; locationId?: number }) {
    const { clientId, locationId } = this.requireScope(scope);
    await this.requireLocation(clientId, locationId);
    const [holdReasons, responsibleParties, dispositions, primaryHealthPlans] = await Promise.all([
      this.holdReasonsRepo.find({ where: { locationId }, order: { id: 'ASC' } }),
      this.responsiblePartiesRepo.find({ where: { locationId }, order: { id: 'ASC' } }),
      this.dispositionsRepo.find({ where: { locationId }, order: { id: 'ASC' } }),
      this.primaryHealthPlansRepo.find({ where: { locationId }, order: { id: 'ASC' } }),
    ]);
    return {
      holdReasons: holdReasons.map((r) => ({ id: Number(r.id), name: r.name, isActive: r.isActive })),
      responsibleParties: responsibleParties.map((r) => ({ id: Number(r.id), name: r.name, isActive: r.isActive })),
      dispositions: dispositions.map((r) => ({ id: Number(r.id), name: r.name, isActive: r.isActive })),
      primaryHealthPlans: primaryHealthPlans.map((r) => ({ id: Number(r.id), name: r.name, isActive: r.isActive })),
    };
  }

  async updateCoding(body: CodingBody, scope: { clientId?: number; locationId?: number }) {
    const { clientId, locationId } = this.requireScope(scope);
    await this.requireLocation(clientId, locationId);
    await Promise.all([
      this.syncNamedScoped(this.holdReasonsRepo, body.holdReasons ?? [], 'locationId', locationId),
      this.syncNamedScoped(this.responsiblePartiesRepo, body.responsibleParties ?? [], 'locationId', locationId),
      this.syncNamedScoped(this.dispositionsRepo, body.dispositions ?? [], 'locationId', locationId),
      this.syncNamedScoped(this.primaryHealthPlansRepo, body.primaryHealthPlans ?? [], 'locationId', locationId),
    ]);
    return this.coding({ clientId, locationId });
  }

  /* ── Chart Fields (DB-backed, with speciality scope) ──── */

  /**
   * Returns the effective chart-field config for the given (location, speciality).
   * If specialityId is provided, the response is the merge of the "All" baseline
   * (specialityId = null) overlaid by speciality-specific deltas.
   * Custom fields follow the same merge rule.
   */
  async chartFields(scope: { clientId?: number; locationId?: number; specialityId?: number | null }) {
    const { clientId, locationId } = this.requireScope(scope);
    await this.requireLocation(clientId, locationId);
    const specialityId = scope.specialityId ?? null;

    const stdRows = await this.stdFieldsRepo.find({
      where: specialityId
        ? [
            { locationId, specialityId: IsNull() },
            { locationId, specialityId },
          ]
        : { locationId, specialityId: IsNull() },
    });
    const stdMap = new Map<string, string>();
    // Apply baseline first, then speciality override
    for (const r of stdRows.filter((r) => r.specialityId === null)) stdMap.set(r.fieldKey, r.requirement);
    for (const r of stdRows.filter((r) => r.specialityId !== null)) stdMap.set(r.fieldKey, r.requirement);

    const customRows = await this.customFieldsRepo.find({
      where: specialityId
        ? [
            { locationId, specialityId: IsNull() },
            { locationId, specialityId },
          ]
        : { locationId, specialityId: IsNull() },
      order: { id: 'ASC' },
    });

    return {
      standardFields: Array.from(stdMap.entries()).map(([key, validation]) => ({ key, validation })),
      customFields: customRows.map((r) => ({
        id: Number(r.id),
        name: r.name,
        type: r.type,
        isMultiSelect: r.isMultiSelect,
        validation: r.validation,
        placement: r.placement,
        options: r.options ?? undefined,
      })),
    };
  }

  async updateChartFields(
    body: {
      standardFields?: Array<{ key: string; validation: string }>;
      customFields?: any[];
    },
    scope: { clientId?: number; locationId?: number; specialityId?: number | null },
  ) {
    const { clientId, locationId } = this.requireScope(scope);
    await this.requireLocation(clientId, locationId);
    const specialityId = scope.specialityId ?? null;

    // Standard fields: upsert each by (locationId, specialityId, fieldKey)
    for (const f of body.standardFields ?? []) {
      const existing = await this.stdFieldsRepo.findOne({
        where: {
          locationId,
          specialityId: specialityId === null ? IsNull() : specialityId,
          fieldKey: f.key,
        } as any,
      });
      if (existing) {
        await this.stdFieldsRepo.update({ id: existing.id }, { requirement: f.validation });
      } else {
        await this.stdFieldsRepo.save(
          this.stdFieldsRepo.create({ locationId, specialityId, fieldKey: f.key, requirement: f.validation }),
        );
      }
    }

    // When saving at baseline, "All (baseline)" should apply to every specialty.
    // Wipe specialty-specific overrides for the same fields so a stale override
    // can't keep winning over a freshly-set baseline.
    if (specialityId === null) {
      const savedKeys = (body.standardFields ?? []).map((f) => f.key);
      if (savedKeys.length > 0) {
        await this.stdFieldsRepo
          .createQueryBuilder()
          .delete()
          .where('location_id = :locationId', { locationId })
          .andWhere('speciality_id IS NOT NULL')
          .andWhere('field_key IN (:...keys)', { keys: savedKeys })
          .execute();
      }
    }

    return this.chartFields({ clientId, locationId, specialityId });
  }

  async createCustomChartField(
    body: { clientId: number; locationId: number; specialityId?: number | null } & {
      name: string;
      type: string;
      isMultiSelect?: boolean;
      validation: string;
      placement?: string;
      options?: string[];
    },
  ) {
    const { clientId, locationId } = this.requireScope(body);
    await this.requireLocation(clientId, locationId);
    const specialityId = body.specialityId ?? null;
    const entity = this.customFieldsRepo.create({
      locationId,
      specialityId,
      name: body.name,
      type: body.type,
      isMultiSelect: body.isMultiSelect ?? false,
      validation: body.validation,
      placement: body.placement ?? 'Chart Info',
      options: body.options ?? undefined,
    });
    const created = await this.customFieldsRepo.save(entity);
    return { id: Number(created.id) };
  }

  async updateCustomChartField(id: number, body: any) {
    const existing = await this.customFieldsRepo.findOne({ where: { id } });
    if (!existing) throw new NotFoundException();
    await this.customFieldsRepo.update(
      { id },
      {
        name: body.name ?? existing.name,
        type: body.type ?? existing.type,
        isMultiSelect: body.isMultiSelect ?? existing.isMultiSelect,
        validation: body.validation ?? existing.validation,
        placement: body.placement ?? existing.placement,
        options: body.options ?? existing.options,
      },
    );
    return this.customFieldsRepo.findOne({ where: { id } });
  }

  async deleteCustomChartField(id: number) {
    await this.customFieldsRepo.delete({ id });
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

  /* ── Code Review Reasons (per client+location, per codeType+action) ── */

  private requireCodeType(value: string): CodeReviewType {
    if (!Object.values(CodeReviewType).includes(value as CodeReviewType)) {
      throw new BadRequestException({
        error: { code: 'invalid_argument', message: `Invalid codeType: ${value}` },
      });
    }
    return value as CodeReviewType;
  }

  private requireAction(value: string): CodeReviewAction {
    if (!Object.values(CodeReviewAction).includes(value as CodeReviewAction)) {
      throw new BadRequestException({
        error: { code: 'invalid_argument', message: `Invalid action: ${value}` },
      });
    }
    return value as CodeReviewAction;
  }

  async getCodeReviewReasons(scope: { clientId?: number; locationId?: number }) {
    const { clientId, locationId } = this.requireScope(scope);
    await this.requireLocation(clientId, locationId);

    const rows = await this.codeReviewReasonsRepo.find({
      where: { clientId, locationId },
      order: { codeType: 'ASC', action: 'ASC', displayOrder: 'ASC', id: 'ASC' },
    });

    return {
      items: rows.map((r) => ({
        id: Number(r.id),
        codeType: r.codeType,
        action: r.action,
        text: r.text,
        displayOrder: r.displayOrder,
        isActive: r.isActive,
      })),
    };
  }

  /**
   * Replaces the full list of reasons for ONE (codeType, action) cell
   * within a (client, location) scope. Rows in the DB but missing from
   * the payload are hard-deleted; rows with an id are updated; rows
   * without an id are inserted. Wrapped in a transaction so a partial
   * failure cannot leave a half-saved cell.
   */
  async updateCodeReviewReasons(body: {
    clientId?: number;
    locationId?: number;
    codeType?: string;
    action?: string;
    reasons?: Array<{ id?: number; text: string; displayOrder?: number; isActive?: boolean }>;
  }) {
    const { clientId, locationId } = this.requireScope(body);
    await this.requireLocation(clientId, locationId);
    const codeType = this.requireCodeType(body.codeType ?? '');
    const action = this.requireAction(body.action ?? '');

    const incoming = (body.reasons ?? [])
      .map((r) => ({
        id: typeof r.id === 'number' ? Number(r.id) : undefined,
        text: (r.text ?? '').trim(),
        displayOrder: typeof r.displayOrder === 'number' ? r.displayOrder : 0,
        isActive: r.isActive !== false,
      }))
      .filter((r) => r.text.length > 0);

    const seenTexts = new Set<string>();
    for (const r of incoming) {
      const key = r.text.toLowerCase();
      if (seenTexts.has(key)) {
        throw new BadRequestException({
          error: { code: 'duplicate', message: `Duplicate reason text: "${r.text}"` },
        });
      }
      seenTexts.add(key);
    }

    await this.dataSource.transaction(async (mgr) => {
      const repo = mgr.getRepository(CodeReviewReason);
      const existing = await repo.find({ where: { clientId, locationId, codeType, action } });
      const incomingIds = incoming.filter((r) => r.id !== undefined).map((r) => r.id!);
      const toDelete = existing.filter((e) => !incomingIds.includes(Number(e.id)));
      if (toDelete.length) await repo.delete({ id: In(toDelete.map((d) => d.id)) });

      for (const r of incoming) {
        if (r.id !== undefined) {
          await repo.update(
            { id: r.id, clientId, locationId, codeType, action },
            { text: r.text, displayOrder: r.displayOrder, isActive: r.isActive },
          );
        } else {
          await repo.save(
            repo.create({
              clientId,
              locationId,
              codeType,
              action,
              text: r.text,
              displayOrder: r.displayOrder,
              isActive: r.isActive,
            }),
          );
        }
      }
    });

    return this.getCodeReviewReasons({ clientId, locationId });
  }

  /**
   * Copies active reasons from a source (client, location) to a target
   * (client, location). Idempotent: skips rows whose (codeType, action,
   * lower(text)) already exists in the target. Optional filters narrow
   * which cells to copy.
   */
  async copyCodeReviewReasons(body: {
    sourceClientId?: number;
    sourceLocationId?: number;
    targetClientId?: number;
    targetLocationId?: number;
    codeTypes?: string[];
    actions?: string[];
    includeDisabled?: boolean;
  }) {
    const source = this.requireScope({ clientId: body.sourceClientId, locationId: body.sourceLocationId });
    const target = this.requireScope({ clientId: body.targetClientId, locationId: body.targetLocationId });
    if (source.clientId === target.clientId && source.locationId === target.locationId) {
      throw new BadRequestException({
        error: { code: 'invalid_argument', message: 'Source and target must differ.' },
      });
    }
    await this.requireLocation(source.clientId, source.locationId);
    await this.requireLocation(target.clientId, target.locationId);

    const codeTypes = (body.codeTypes ?? Object.values(CodeReviewType)).map((t) => this.requireCodeType(t));
    const actions = (body.actions ?? Object.values(CodeReviewAction)).map((a) => this.requireAction(a));

    let copied = 0;
    let skipped = 0;

    await this.dataSource.transaction(async (mgr) => {
      const repo = mgr.getRepository(CodeReviewReason);
      const sourceRows = await repo.find({
        where: {
          clientId: source.clientId,
          locationId: source.locationId,
          codeType: In(codeTypes),
          action: In(actions),
        },
      });
      const targetRows = await repo.find({
        where: {
          clientId: target.clientId,
          locationId: target.locationId,
          codeType: In(codeTypes),
          action: In(actions),
        },
      });

      const targetKeys = new Set(targetRows.map((r) => `${r.codeType}|${r.action}|${r.text.toLowerCase()}`));

      for (const s of sourceRows) {
        if (!body.includeDisabled && !s.isActive) {
          skipped++;
          continue;
        }
        const key = `${s.codeType}|${s.action}|${s.text.toLowerCase()}`;
        if (targetKeys.has(key)) {
          skipped++;
          continue;
        }
        await repo.save(
          repo.create({
            clientId: target.clientId,
            locationId: target.locationId,
            codeType: s.codeType,
            action: s.action,
            text: s.text,
            displayOrder: s.displayOrder,
            isActive: s.isActive,
          }),
        );
        targetKeys.add(key);
        copied++;
      }
    });

    return { copied, skipped };
  }

  /** Used by the charts service to validate that a submitted dropdown
   * value matches an active reason for the chart's (client, location,
   * codeType, action). */
  async findActiveReasonText(opts: {
    clientId: number;
    locationId: number;
    codeType: CodeReviewType;
    action: CodeReviewAction;
    text: string;
  }) {
    return this.codeReviewReasonsRepo.findOne({
      where: {
        clientId: opts.clientId,
        locationId: opts.locationId,
        codeType: opts.codeType,
        action: opts.action,
        text: opts.text,
        isActive: true,
      },
    });
  }
}
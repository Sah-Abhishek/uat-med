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
import { ServiceLine } from '../../entities/service-line.entity';

const BUILTIN_AUDIT_AREAS = [
  'Primary Diagnosis',
  'Secondary Diagnosis',
  'Procedures',
  'ED/EM Level',
  'Modifier',
  'POA Indicator',
  'DRG Value',
];

/**
 * Standard sub-speciality catalogue seeded onto every location. Backfilled onto
 * existing locations by migration 1715001000000; this list keeps newly-created
 * locations in sync so every client + location pair carries the same set.
 *
 * Names MUST match the AI gateway's GET /api/specialities vocabulary byte-for-byte
 * — we forward the worklist sub-speciality verbatim as `sub_speciality` and the
 * gateway matches case/space-sensitively, so any drift silently disables the
 * speciality-tuned RAG. `EM -OP` and `WHC Profee/ facility` use the gateway's
 * (slightly odd) spacing on purpose. Migration 1715001200000 corrected the
 * existing rows that 1715001000000 seeded with the old spacing — that older
 * migration's SEED array intentionally keeps the pre-correction spelling so its
 * own down() stays self-consistent; do not "sync" it to this list.
 */
const DEFAULT_SUB_SPECIALITIES = [
  'ED Facility',
  'ED Profee',
  'EM -OP',
  'EM-IP',
  'Ob-gyn',
  'New born',
  'SDS',
  'General Surgery',
  'WHC Profee/ facility',
  'ASC',
  'Ancillary',
  'IP-DRG',
  'HCC',
  'PT/OT',
  'Surgical Pathology',
  'Macular Pathology',
  'Radiology',
  'IVR',
  'Denial/ Edits',
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
    @InjectRepository(ServiceLine) private readonly serviceLinesRepo: Repository<ServiceLine>,
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

  async listClients(includeInactive = false) {
    // Soft-deleted clients have isActive=false. Hidden by default so they drop
    // out of every picker/creation flow; the config management view opts in
    // with includeInactive=true to edit/restore them.
    const where = includeInactive ? {} : { isActive: true };
    const rows = await this.clientsRepo.find({
      where,
      order: { name: 'ASC' },
      relations: ['locations'],
    }).catch(() => this.clientsRepo.find({ where, order: { name: 'ASC' } }));

    const items = rows.map((c) => ({
      id: c.id,
      name: c.name,
      code: c.code ?? '',
      isActive: c.isActive ?? true,
      allowDuplicateChartNumbers: c.allowDuplicateChartNumbers ?? false,
      locations: (c as any).locations ?? [],
    }));
    return { items };
  }

  async createClient(body: { name: string; code?: string; isActive?: boolean; allowDuplicateChartNumbers?: boolean }) {
    const code = body.code?.trim();
    const client = this.clientsRepo.create({
      name: body.name,
      // Absent/empty code → NULL. The `code` column is UNIQUE; storing '' makes
      // the second code-less client collide on the unique index, whereas
      // Postgres permits many NULLs.
      code: code ? code : null,
      isActive: body.isActive ?? true,
      // Strict chart-number uniqueness is the default; a new client only relaxes
      // it if whoever created it deliberately said so.
      allowDuplicateChartNumbers: body.allowDuplicateChartNumbers ?? false,
    });
    const saved = await this.clientsRepo.save(client);
    return { id: saved.id };
  }

  async updateClient(id: number, body: { name?: string; code?: string; isActive?: boolean; allowDuplicateChartNumbers?: boolean }) {
    const client = await this.clientsRepo.findOne({ where: { id } });
    if (!client) {
      throw new NotFoundException({ error: { code: 'not_found', message: `Client ${id} not found.` } });
    }
    if (body.name !== undefined) client.name = body.name;
    // Normalise empty code to NULL — see createClient (unique index on code).
    if (body.code !== undefined) client.code = body.code.trim() || null;
    if (body.isActive !== undefined) client.isActive = body.isActive;
    if (body.allowDuplicateChartNumbers !== undefined) client.allowDuplicateChartNumbers = body.allowDuplicateChartNumbers;
    await this.clientsRepo.save(client);
    return { id: client.id };
  }

  /** Soft delete: deactivate so it's hidden everywhere but never removed.
   * Restore by editing it back to active. */
  async deactivateClient(id: number) {
    const client = await this.clientsRepo.findOne({ where: { id } });
    if (!client) {
      throw new NotFoundException({ error: { code: 'not_found', message: `Client ${id} not found.` } });
    }
    client.isActive = false;
    await this.clientsRepo.save(client);
    return { id: client.id, isActive: false };
  }

  /**
   * Hard delete with cascade. Permanently removes the client and everything
   * under it. Only `users` and `worklists` hold real FKs to client/location;
   * config tables (processes, specialities, …) carry loose id columns with no
   * constraint, so they don't block the delete. We:
   *   1. null out user.client_id / user.location_id (FK would otherwise block),
   *   2. delete the client's worklists (charts → allocations / decisions /
   *      feedback cascade at the DB level),
   *   3. delete the client (its locations cascade via Location→Client).
   * All in one transaction so a failure leaves nothing half-deleted.
   */
  async cascadeDeleteClient(id: number) {
    const client = await this.clientsRepo.findOne({ where: { id } });
    if (!client) {
      throw new NotFoundException({ error: { code: 'not_found', message: `Client ${id} not found.` } });
    }
    await this.dataSource.transaction(async (em) => {
      const locRows: Array<{ id: string }> = await em.query('SELECT id FROM locations WHERE client_id = $1', [id]);
      const locationIds = locRows.map((r) => Number(r.id));
      await em.query('UPDATE users SET client_id = NULL WHERE client_id = $1', [id]);
      await em.query('UPDATE users SET location_id = NULL WHERE location_id = ANY($1::bigint[])', [locationIds]);
      await em.query('DELETE FROM worklists WHERE client_id = $1', [id]);
      await em.query('DELETE FROM worklists WHERE location_id = ANY($1::bigint[])', [locationIds]);
      await em.query('DELETE FROM clients WHERE id = $1', [id]);
    });
    return { id, deleted: true };
  }

  /* ── Locations (TypeORM-backed) ───────────────────────── */

  async listLocations(clientId: number, includeInactive = false) {
    const rows = await this.locationsRepo.find({
      where: includeInactive ? { clientId } : { clientId, isActive: true },
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

    // Seed the standard sub-speciality catalogue for the new location so every
    // client + location pair carries the same set (matches the one-off backfill
    // migration for existing locations). Best-effort: never block location
    // creation if a row collides or the insert hiccups.
    try {
      await this.subSpecsRepo.save(
        DEFAULT_SUB_SPECIALITIES.map((name) =>
          this.subSpecsRepo.create({ locationId: Number(saved.id), name, isActive: true }),
        ),
      );
    } catch {
      /* sub-specialities are non-critical to location creation; ignore */
    }

    return { id: saved.id };
  }

  async updateLocation(id: number, body: { name?: string; code?: string; isActive?: boolean }) {
    const loc = await this.locationsRepo.findOne({ where: { id } });
    if (!loc) {
      throw new NotFoundException({ error: { code: 'not_found', message: `Location ${id} not found.` } });
    }
    if (body.name !== undefined) loc.name = body.name;
    if (body.code !== undefined) loc.code = body.code;
    if (body.isActive !== undefined) loc.isActive = body.isActive;
    await this.locationsRepo.save(loc);
    return { id: loc.id };
  }

  /** Soft delete: deactivate so it's hidden everywhere but never removed. */
  async deactivateLocation(id: number) {
    const loc = await this.locationsRepo.findOne({ where: { id } });
    if (!loc) {
      throw new NotFoundException({ error: { code: 'not_found', message: `Location ${id} not found.` } });
    }
    loc.isActive = false;
    await this.locationsRepo.save(loc);
    return { id: loc.id, isActive: false };
  }

  /** Hard delete with cascade — permanently removes the location and all
   * worklists/charts under it; unassigns users at this location. See
   * cascadeDeleteClient for the FK reasoning. */
  async cascadeDeleteLocation(id: number) {
    const loc = await this.locationsRepo.findOne({ where: { id } });
    if (!loc) {
      throw new NotFoundException({ error: { code: 'not_found', message: `Location ${id} not found.` } });
    }
    await this.dataSource.transaction(async (em) => {
      await em.query('UPDATE users SET location_id = NULL WHERE location_id = $1', [id]);
      await em.query('DELETE FROM worklists WHERE location_id = $1', [id]);
      await em.query('DELETE FROM locations WHERE id = $1', [id]);
    });
    return { id, deleted: true };
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

  /** Lightweight: active sub-specialities for one location (worklist dropdown). */
  async listSubSpecialitiesByLocation(locationId: number) {
    const rows = await this.subSpecsRepo.find({
      where: { locationId, isActive: true },
      order: { id: 'ASC' },
    });
    return {
      items: rows.map((r) => ({ id: Number(r.id), locationId: Number(r.locationId), name: r.name })),
    };
  }

  /** Every distinct active sub-speciality name across all locations, deduped and
   * ordered — for the charts filter that matches by name (not location-scoped). */
  async listAllSubSpecialities() {
    const rows = await this.subSpecsRepo
      .createQueryBuilder('s')
      .select('DISTINCT s.name', 'name')
      .where('s.is_active = true')
      .orderBy('s.name', 'ASC')
      .getRawMany<{ name: string }>();
    return { items: rows.map((r) => ({ name: r.name })) };
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
        isActive: a.isActive,
        reasons: (reasonsByArea.get(Number(a.id)) ?? []).map((r) => ({
          id: Number(r.id),
          name: r.name,
        })),
      })),
    };
  }

  async updateFeedbackCategories(
    body: { areas?: Array<{ id: number; reasons?: Array<{ id?: number; name: string }>; isActive?: boolean }> },
    scope: { clientId?: number; locationId?: number },
  ) {
    const { clientId, locationId } = this.requireScope(scope);
    await this.requireLocation(clientId, locationId);

    for (const area of body.areas ?? []) {
      const areaId = Number(area.id);
      // Confirm the area belongs to this location (security check).
      const owned = await this.auditAreasRepo.findOne({ where: { id: areaId, locationId } });
      if (!owned) continue;

      // Active/inactive toggle — applies to every area, including built-ins
      // (which can't be deleted but can be hidden from the audit table).
      if (typeof area.isActive === 'boolean' && area.isActive !== owned.isActive) {
        await this.auditAreasRepo.update({ id: areaId }, { isActive: area.isActive });
      }

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

  /**
   * Copy feedback categories (audit areas + their reasons) from one Client +
   * Location scope into another. Purely ADDITIVE and idempotent: it creates any
   * audit area the destination is missing and adds any reason a destination area
   * doesn't already have — it never deletes destination areas/reasons or changes
   * their existing active/hidden toggles. Matching is by name (unique per
   * location), so built-ins line up automatically and re-running is a no-op.
   */
  async copyFeedbackCategories(body: {
    source?: { clientId?: number; locationId?: number };
    destination?: { clientId?: number; locationId?: number };
  }) {
    const src = this.requireScope(body.source ?? {});
    const dest = this.requireScope(body.destination ?? {});
    await this.requireLocation(src.clientId, src.locationId);
    await this.requireLocation(dest.clientId, dest.locationId);

    // Copying a scope onto itself changes nothing — return its current state.
    if (src.locationId === dest.locationId) {
      return { status: 'ok', areasAdded: 0, reasonsAdded: 0, ...(await this.feedbackCategories(dest)) };
    }

    // Seed built-ins on both sides so their names align before matching.
    await this.ensureBuiltinAuditAreas(src.locationId);
    await this.ensureBuiltinAuditAreas(dest.locationId);

    const [srcAreas, srcReasons, destAreas, destReasons] = await Promise.all([
      this.auditAreasRepo.find({ where: { locationId: src.locationId } }),
      this.auditReasonsRepo.find({ where: { locationId: src.locationId } }),
      this.auditAreasRepo.find({ where: { locationId: dest.locationId } }),
      this.auditReasonsRepo.find({ where: { locationId: dest.locationId } }),
    ]);

    const srcReasonsByArea = new Map<number, AuditFeedbackReason[]>();
    for (const r of srcReasons) {
      const aid = Number(r.auditAreaId);
      if (!srcReasonsByArea.has(aid)) srcReasonsByArea.set(aid, []);
      srcReasonsByArea.get(aid)!.push(r);
    }
    const destAreaByName = new Map<string, AuditArea>(destAreas.map((a) => [a.name, a]));
    const destReasonNamesByArea = new Map<number, Set<string>>();
    for (const r of destReasons) {
      const aid = Number(r.auditAreaId);
      if (!destReasonNamesByArea.has(aid)) destReasonNamesByArea.set(aid, new Set());
      destReasonNamesByArea.get(aid)!.add(r.name);
    }

    let areasAdded = 0;
    let reasonsAdded = 0;

    for (const srcArea of srcAreas) {
      let destArea = destAreaByName.get(srcArea.name);
      if (!destArea) {
        // Recreate the missing area faithfully (flags + active state carried over).
        destArea = await this.auditAreasRepo.save(
          this.auditAreasRepo.create({
            locationId: dest.locationId,
            name: srcArea.name,
            isBuiltin: srcArea.isBuiltin,
            isSystem: srcArea.isSystem,
            isActive: srcArea.isActive,
          }),
        );
        destAreaByName.set(destArea.name, destArea);
        areasAdded++;
      }

      const have = destReasonNamesByArea.get(Number(destArea.id)) ?? new Set<string>();
      const toAdd = (srcReasonsByArea.get(Number(srcArea.id)) ?? []).filter((r) => !have.has(r.name));
      if (toAdd.length) {
        await this.auditReasonsRepo.save(
          toAdd.map((r) =>
            this.auditReasonsRepo.create({ auditAreaId: destArea!.id, locationId: dest.locationId, name: r.name }),
          ),
        );
        reasonsAdded += toAdd.length;
      }
    }

    return { status: 'ok', areasAdded, reasonsAdded, ...(await this.feedbackCategories(dest)) };
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

  /**
   * Copy the source Client/Location's custom chart fields into the destination
   * scope. Only the source location's baseline (specialityId IS NULL) fields are
   * copied — that's the location-wide set that ports cleanly across clients
   * (speciality ids aren't shared between clients). They land at the
   * destination's currently-selected speciality scope (usually the baseline).
   * Matched by name so it's idempotent — anything already present is left as-is.
   */
  async copyCustomChartFields(body: {
    source?: { clientId?: number; locationId?: number };
    destination?: { clientId?: number; locationId?: number; specialityId?: number | null };
  }) {
    const src = this.requireScope(body.source ?? {});
    const dest = this.requireScope(body.destination ?? {});
    await this.requireLocation(src.clientId, src.locationId);
    await this.requireLocation(dest.clientId, dest.locationId);
    const destSpecialityId = body.destination?.specialityId ?? null;

    // Source's location-wide (baseline) custom fields.
    const srcRows = await this.customFieldsRepo.find({
      where: { locationId: src.locationId, specialityId: IsNull() },
      order: { id: 'ASC' },
    });

    // Existing fields in the destination scope — matched by name so re-running
    // the copy never creates duplicates (also respects the unique index on
    // (location_id, speciality_id, name)).
    const destRows = await this.customFieldsRepo.find({
      where: {
        locationId: dest.locationId,
        specialityId: destSpecialityId === null ? IsNull() : destSpecialityId,
      } as any,
    });
    const have = new Set(destRows.map((r) => r.name));
    const toAdd = srcRows.filter((r) => !have.has(r.name));

    if (toAdd.length) {
      await this.customFieldsRepo.save(
        toAdd.map((r) =>
          this.customFieldsRepo.create({
            locationId: dest.locationId,
            specialityId: destSpecialityId,
            name: r.name,
            type: r.type,
            isMultiSelect: r.isMultiSelect,
            validation: r.validation,
            placement: r.placement,
            options: r.options ?? undefined,
          }),
        ),
      );
    }

    return {
      status: 'ok',
      fieldsAdded: toAdd.length,
      ...(await this.chartFields({
        clientId: dest.clientId,
        locationId: dest.locationId,
        specialityId: destSpecialityId,
      })),
    };
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

  /* ── Service Lines (global lookup, TypeORM-backed) ────────
   *
   * Global catalogue picked at document-upload time and stored per chart
   * (charts.service_line_id). NOT client/location-scoped. Ordered by sort_order
   * so the business sequence (ED Facility, ED Profee, …) holds in every picker.
   * Soft-delete via isActive=false (mirrors clients/locations) — never hard
   * delete, so charts that reference a line stay valid. */

  async listServiceLines(includeInactive = false) {
    const where = includeInactive ? {} : { isActive: true };
    const rows = await this.serviceLinesRepo.find({
      where,
      // sort_order first, name as a stable tiebreaker for equal/zero orders.
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    const items = rows.map((s) => ({
      id: Number(s.id),
      name: s.name,
      code: s.code ?? '',
      sortOrder: s.sortOrder ?? 0,
      isActive: s.isActive ?? true,
    }));
    return { items };
  }

  async createServiceLine(body: { name?: string; code?: string; sortOrder?: number; isActive?: boolean }) {
    const name = (body.name ?? '').trim();
    if (!name) {
      throw new BadRequestException({ error: { code: 'invalid_argument', message: 'Service line name is required.' } });
    }
    const code = body.code?.trim();
    // Default new lines to the end of the list when no explicit order is given.
    let sortOrder = typeof body.sortOrder === 'number' ? body.sortOrder : undefined;
    if (sortOrder === undefined) {
      const max = await this.serviceLinesRepo
        .createQueryBuilder('s')
        .select('MAX(s.sort_order)', 'max')
        .getRawOne<{ max: number | null }>();
      sortOrder = (Number(max?.max ?? 0) || 0) + 10;
    }
    const entity = this.serviceLinesRepo.create({
      name,
      // Empty/absent code → NULL (unique index permits many NULLs but not many '').
      code: code ? code : null,
      sortOrder,
      isActive: body.isActive ?? true,
    });
    const saved = await this.serviceLinesRepo.save(entity);
    return { id: Number(saved.id) };
  }

  async updateServiceLine(
    id: number,
    body: { name?: string; code?: string; sortOrder?: number; isActive?: boolean },
  ) {
    const row = await this.serviceLinesRepo.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException({ error: { code: 'not_found', message: `Service line ${id} not found.` } });
    }
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) {
        throw new BadRequestException({ error: { code: 'invalid_argument', message: 'Service line name cannot be empty.' } });
      }
      row.name = name;
    }
    if (body.code !== undefined) row.code = body.code.trim() || null;
    if (body.sortOrder !== undefined) row.sortOrder = body.sortOrder;
    if (body.isActive !== undefined) row.isActive = body.isActive;
    await this.serviceLinesRepo.save(row);
    return { id: Number(row.id) };
  }

  /** Soft delete: deactivate so it drops out of every picker but charts that
   * already reference it keep their value. Restore by editing back to active. */
  async deactivateServiceLine(id: number) {
    const row = await this.serviceLinesRepo.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException({ error: { code: 'not_found', message: `Service line ${id} not found.` } });
    }
    row.isActive = false;
    await this.serviceLinesRepo.save(row);
    return { id: Number(row.id), isActive: false };
  }
}
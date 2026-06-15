import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, In } from 'typeorm';
import { Worklist } from '../../entities/worklist.entity';
import { Chart } from '../../entities/chart.entity';
import { ChartAllocation } from '../../entities/chart-allocation.entity';
import { ChartMilestone, WorklistStatus } from '../../common/enums';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { CreateWorklistDto } from './dto/create-worklist.dto';
import { UpdateWorklistDto } from './dto/update-worklist.dto';
import { QueryWorklistsDto } from './dto/query-worklists.dto';
import { AllocateWorklistDto } from './dto/allocate-worklist.dto';

@Injectable()
export class WorklistsService {
  constructor(
    @InjectRepository(Worklist) private readonly worklists: Repository<Worklist>,
    @InjectRepository(Chart) private readonly charts: Repository<Chart>,
    @InjectRepository(ChartAllocation) private readonly allocations: Repository<ChartAllocation>,
    private readonly ds: DataSource,
  ) {}

  async list(q: QueryWorklistsDto) {
    const qb = this.worklists
      .createQueryBuilder('w')
      // Join the config relations so the list can show names, not raw ids
      // (mirrors how the charts list resolves the same hierarchy).
      .leftJoinAndSelect('w.client', 'client')
      .leftJoinAndSelect('w.location', 'location')
      .leftJoinAndSelect('w.primarySpeciality', 'primarySpeciality')
      .leftJoinAndSelect('w.subSpeciality', 'subSpeciality')
      .leftJoinAndSelect('w.process', 'process');
    if (q.status) qb.andWhere('w.status = :s', { s: q.status });
    if (q.clientId) qb.andWhere('w.client_id = :c', { c: q.clientId });
    if (q.locationId) qb.andWhere('w.location_id = :l', { l: q.locationId });
    if (q.primarySpecialityId) qb.andWhere('w.primary_speciality_id = :p', { p: q.primarySpecialityId });
    if (q.processId) qb.andWhere('w.process_id = :pr', { pr: q.processId });
    if (q.receivedDateFrom) qb.andWhere('w.received_date >= :rf', { rf: q.receivedDateFrom });
    if (q.receivedDateTo) qb.andWhere('w.received_date <= :rt', { rt: q.receivedDateTo });

    qb.orderBy(`w.${q.sortBy ?? 'receivedDate'}`, q.sortDir === 'asc' ? 'ASC' : 'DESC');
    qb.skip((q.page - 1) * q.pageSize).take(q.pageSize);

    const [items, total] = await qb.getManyAndCount();

    if (items.length === 0) {
      return new PaginatedResponseDto(items, total, q.page, q.pageSize);
    }

    const ids = items.map((w) => w.id);
    const counts = await this.charts
      .createQueryBuilder('c')
      .select('c.worklist_id', 'worklistId')
      .addSelect('COUNT(*)', 'rowCount')
      .addSelect(
        `SUM(CASE WHEN c.allocated_coder_id IS NOT NULL OR c.allocated_auditor_id IS NOT NULL THEN 1 ELSE 0 END)`,
        'allocated',
      )
      .addSelect(`SUM(CASE WHEN c.milestone = 'CLOSED' THEN 1 ELSE 0 END)`, 'closed')
      .where('c.worklist_id IN (:...ids)', { ids })
      .groupBy('c.worklist_id')
      .getRawMany();

    const countMap = new Map<string, { rowCount: number; allocated: number; closed: number }>();
    for (const r of counts) {
      countMap.set(String(r.worklistId), {
        rowCount: Number(r.rowCount ?? 0),
        allocated: Number(r.allocated ?? 0),
        closed: Number(r.closed ?? 0),
      });
    }

    const augmented = items.map((w) => {
      const c = countMap.get(String(w.id)) ?? { rowCount: 0, allocated: 0, closed: 0 };
      const declared = Number(w.totalCharts ?? 0);
      const total = Math.max(declared, c.rowCount);
      // Strip the joined relation objects and surface flat *Name fields
      // alongside the existing ids (same shape convention as the charts list).
      const { client, location, primarySpeciality, subSpeciality, process, ...rest } = w;
      return {
        ...rest,
        clientName: client?.name ?? null,
        locationName: location?.name ?? null,
        specialityName: primarySpeciality?.name ?? null,
        subSpecialityName: subSpeciality?.name ?? null,
        processName: process?.name ?? null,
        totalCharts: total,
        allocatedCharts: c.allocated,
        closedCharts: c.closed,
      };
    });

    return new PaginatedResponseDto(augmented, total, q.page, q.pageSize);
  }

  async statusSummary(q: { clientId?: number; locationId?: number } = {}) {
    const qb = this.worklists
      .createQueryBuilder('w').select('w.status', 'status').addSelect('COUNT(*)', 'count');
    // Global header scope (Client / Location).
    if (q.clientId) qb.andWhere('w.client_id = :cid', { cid: Number(q.clientId) });
    if (q.locationId) qb.andWhere('w.location_id = :lid', { lid: Number(q.locationId) });
    const rows = await qb.groupBy('w.status').getRawMany();
    const out = { open: 0, inProgress: 0, closed: 0 };
    rows.forEach(r => {
      if (r.status === WorklistStatus.OPEN) out.open = Number(r.count);
      if (r.status === WorklistStatus.IN_PROGRESS) out.inProgress = Number(r.count);
      if (r.status === WorklistStatus.CLOSED) out.closed = Number(r.count);
    });
    return out;
  }

  async create(dto: CreateWorklistDto, userId: number) {
    const existing = await this.worklists.findOne({ where: { worklistNumber: dto.worklistNumber } });
    if (existing) throw new ConflictException({ error: { code: 'conflict', message: 'worklistNumber already exists.' } });

    const total = dto.numberOfCharts ?? 0;
    return this.ds.transaction(async (manager) => {
      const wRepo = manager.getRepository(Worklist);
      const cRepo = manager.getRepository(Chart);
      const w = wRepo.create({
        worklistNumber: dto.worklistNumber,
        clientId: dto.clientId,
        locationId: dto.locationId,
        primarySpecialityId: dto.primarySpecialityId,
        subSpecialityId: dto.subSpecialityId,
        processId: dto.processId,
        dateOfService: dto.dateOfService,
        dateOfServiceTo: dto.dateOfServiceTo,
        receivedDate: dto.receivedDate,
        totalCharts: total,
        createdBy: userId,
      });
      const saved = await wRepo.save(w);

      // Create N placeholder Chart rows with serial_no 1..N so allocations have something to attach to.
      if (total > 0) {
        const placeholders = Array.from({ length: total }, (_, i) =>
          cRepo.create({ worklistId: saved.id, serialNo: i + 1 }),
        );
        // Bulk-save in chunks of 200 to avoid massive single INSERTs on large worklists.
        const CHUNK = 200;
        for (let i = 0; i < placeholders.length; i += CHUNK) {
          await cRepo.save(placeholders.slice(i, i + CHUNK));
        }
      }

      return {
        id: saved.id,
        worklistNumber: saved.worklistNumber,
        status: saved.status,
        totalCharts: saved.totalCharts,
        importTaskId: null,
      };
    });
  }

  async detail(id: number) {
    const w = await this.worklists.findOne({
      where: { id },
      relations: ['client', 'location', 'primarySpeciality', 'subSpeciality', 'process'],
    });
    if (!w) throw new NotFoundException();
    const counts = await this.charts.createQueryBuilder('c')
      .select('COUNT(*)', 'rowCount')
      .addSelect(`SUM(CASE WHEN c.allocated_coder_id IS NOT NULL OR c.allocated_auditor_id IS NOT NULL THEN 1 ELSE 0 END)`, 'allocated')
      .addSelect(`SUM(CASE WHEN c.milestone = 'READY_TO_CODE' THEN 1 ELSE 0 END)`, 'notStarted')
      .addSelect(`SUM(CASE WHEN c.milestone IN ('CODING_IN_PROGRESS','AUDIT_IN_PROGRESS') THEN 1 ELSE 0 END)`, 'inProgress')
      .addSelect(`SUM(CASE WHEN c.milestone = 'CLOSED' THEN 1 ELSE 0 END)`, 'closed')
      // Total documents uploaded across this worklist's charts. Each chart keeps
      // its files in custom_fields.uploadedDocs (a JSONB array); sum the lengths.
      .addSelect(
        `COALESCE(SUM(CASE WHEN jsonb_typeof(c.custom_fields->'uploadedDocs') = 'array'
                           THEN jsonb_array_length(c.custom_fields->'uploadedDocs') ELSE 0 END), 0)`,
        'documentsCount',
      )
      .where('c.worklist_id = :id', { id })
      .getRawOne();
    const rowCount = Number(counts.rowCount ?? 0);
    const declared = Number(w.totalCharts ?? 0);
    // Prefer declared volume from creation; once actual chart rows exceed it, use the actual count.
    const total = Math.max(declared, rowCount);
    const allocated = Number(counts.allocated ?? 0);
    const unallocated = Math.max(0, total - allocated);

    // AI pipeline status counts — same mutually-exclusive ordering as
    // charts.summary() so the worklist progress card never disagrees with
    // the chart list's AI tiles. Scope is this worklist's charts only.
    const aiBase = this.charts.createQueryBuilder('c').where('c.worklist_id = :id', { id });
    const aiQueued = await aiBase.clone()
      .andWhere(`c.custom_fields ? 'pendingPrediction'`)
      .andWhere(`COALESCE(c.custom_fields->'pendingPrediction'->>'gatewayStatus','PENDING') = 'PENDING'`)
      .getCount();
    const aiProcessing = await aiBase.clone()
      .andWhere(`c.custom_fields ? 'pendingPrediction'`)
      .andWhere(`c.custom_fields->'pendingPrediction'->>'gatewayStatus' = 'STARTED'`)
      .getCount();
    const aiErrored = await aiBase.clone()
      .andWhere(`NOT (c.custom_fields ? 'pendingPrediction')`)
      .andWhere(`c.custom_fields ? 'aiPredictionError'`)
      .getCount();
    const aiDone = await aiBase.clone()
      .andWhere(`NOT (c.custom_fields ? 'pendingPrediction')`)
      .andWhere(`NOT (c.custom_fields ? 'aiPredictionError')`)
      .andWhere(`c.custom_fields ? 'aiPrediction'`)
      .getCount();
    const aiNone = Math.max(0, rowCount - aiQueued - aiProcessing - aiErrored - aiDone);

    return {
      id: w.id,
      worklistNumber: w.worklistNumber,
      // Flat IDs (used by edit form, list filters)
      clientId: Number(w.clientId),
      locationId: Number(w.locationId),
      primarySpecialityId: Number(w.primarySpecialityId),
      subSpecialityId: w.subSpecialityId != null ? Number(w.subSpecialityId) : null,
      processId: Number(w.processId),
      // Nested name objects (used by detail card)
      client: w.client ? { id: Number(w.client.id), name: w.client.name } : null,
      location: w.location ? { id: Number(w.location.id), name: w.location.name } : null,
      primarySpeciality: w.primarySpeciality
        ? { id: Number(w.primarySpeciality.id), name: w.primarySpeciality.name }
        : null,
      subSpeciality: w.subSpeciality
        ? { id: Number(w.subSpeciality.id), name: w.subSpeciality.name }
        : null,
      process: w.process ? { id: Number(w.process.id), name: w.process.name } : null,
      dateOfService: w.dateOfService,
      dateOfServiceTo: w.dateOfServiceTo,
      receivedDate: w.receivedDate,
      status: w.status,
      totalCharts: w.totalCharts,
      netChange: w.netChange,
      documentsCount: Number(counts.documentsCount ?? 0),
      chartSummary: {
        total,
        allocated,
        unallocated,
        notStarted: Number(counts.notStarted ?? 0),
        inProgress: Number(counts.inProgress ?? 0),
        closed: Number(counts.closed ?? 0),
      },
      aiStatusCounts: {
        queued: aiQueued,
        processing: aiProcessing,
        done: aiDone,
        errored: aiErrored,
        none: aiNone,
      },
    };
  }

  async update(id: number, dto: UpdateWorklistDto) {
    const w = await this.worklists.findOne({ where: { id } });
    if (!w) throw new NotFoundException();
    Object.assign(w, dto);
    return this.worklists.save(w);
  }

  async remove(id: number, echo: string) {
    const w = await this.worklists.findOne({ where: { id } });
    if (!w) throw new NotFoundException();
    if (w.worklistNumber !== echo) {
      throw new BadRequestException({ error: { code: 'bad_request', message: 'worklistNumber in body does not match the resource.' } });
    }
    await this.worklists.softRemove(w);
    return { status: 'deleted' };
  }

  async allocate(id: number, dto: AllocateWorklistDto, userId: number) {
    const w = await this.worklists.findOne({ where: { id } });
    if (!w) throw new NotFoundException();

    // Validate the ranges up front. Previously the service quietly skipped
    // any serial that didn't exist (a stale "1–20" against a worklist with
    // 10 charts would allocate 10 and report success), which made the UI
    // look like the request worked when it half-failed. Now we reject the
    // whole batch with a single message listing every problem.
    const issues: string[] = [];
    const allowedRange = await this.charts.createQueryBuilder('c')
      .select('MIN(c.serial_no)', 'minSerial')
      .addSelect('MAX(c.serial_no)', 'maxSerial')
      .where('c.worklist_id = :id', { id })
      .getRawOne<{ minSerial: number | null; maxSerial: number | null }>();
    const maxSerial = Number(allowedRange?.maxSerial ?? 0);
    const minSerial = Number(allowedRange?.minSerial ?? 0);

    for (const a of dto.allocations) {
      const from = Number(a.from);
      const to = Number(a.to);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
        issues.push(`Range ${a.from}–${a.to} is not a valid serial range.`);
        continue;
      }
      if (maxSerial === 0) {
        issues.push(`Worklist has no charts to allocate.`);
        break;
      }
      if (from < minSerial || to > maxSerial) {
        issues.push(`Range ${from}–${to} is outside this worklist's serials (${minSerial}–${maxSerial}).`);
        continue;
      }
      const wanted = range(from, to);
      const existing = await this.charts.find({
        where: { worklistId: id, serialNo: In(wanted) },
        select: { serialNo: true },
      });
      const present = new Set(existing.map((c) => Number(c.serialNo)));
      const missing = wanted.filter((s) => !present.has(s));
      if (missing.length) {
        issues.push(
          `Range ${from}–${to}: serial${missing.length === 1 ? '' : 's'} ${formatMissingSerials(missing)} ${missing.length === 1 ? 'does' : 'do'} not exist (they may have been deleted).`,
        );
      }
    }
    if (issues.length) {
      throw new BadRequestException({
        error: { code: 'invalid_range', message: issues.join(' ') },
      });
    }

    return this.ds.transaction(async manager => {
      let allocated = 0;
      for (const a of dto.allocations) {
        const charts = await manager.getRepository(Chart).find({
          where: { worklistId: id, serialNo: In(range(a.from, a.to)) },
        });
        for (const c of charts) {
          if (a.role === 'CODER') {
            c.allocatedCoderId = a.assigneeId;
            c.originalCoderId ??= a.assigneeId;
            // First-time coder allocation lifts the chart out of "Ready to allocate"
            // into "Ready to code" so the coder can start the timer.
            if (c.milestone === ChartMilestone.READY_TO_ALLOCATE) {
              c.setMilestone(ChartMilestone.READY_TO_CODE);
            }
          } else {
            c.allocatedAuditorId = a.assigneeId;
            c.originalAuditorId ??= a.assigneeId;
            // After coding is done, allocating an auditor moves the chart to ready-to-audit.
            if (c.milestone === ChartMilestone.CODING_DONE) {
              c.setMilestone(ChartMilestone.READY_TO_AUDIT);
            }
          }
          await manager.getRepository(Chart).save(c);
          await manager.getRepository(ChartAllocation).save(manager.getRepository(ChartAllocation).create({
            chartId: c.id, userId: a.assigneeId, role: a.role, allocatedBy: userId,
          }));
          allocated++;
        }
      }
      const remaining = await manager.getRepository(Chart).count({ where: { worklistId: id, allocatedCoderId: null as any } });
      if (allocated > 0 && w.status === WorklistStatus.OPEN) {
        w.status = WorklistStatus.IN_PROGRESS;
        await manager.getRepository(Worklist).save(w);
      }
      return { allocated, remaining };
    });
  }

  async reallocate(id: number, body: { from: number; to: number; assigneeId: number; role: 'CODER' | 'AUDITOR' }, userId: number) {
    return this.allocate(id, { allocations: [body] }, userId).then(r => ({ reallocated: r.allocated, remaining: r.remaining, incompleteAllocation: false }));
  }
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

/**
 * Compress missing serials into a compact "1–3, 5, 7–8" string so error
 * messages stay short even when many serials are missing. Caps the output at
 * five tokens — anything beyond is summarised as "+ N more".
 */
function formatMissingSerials(missing: number[]): string {
  if (missing.length === 0) return '';
  const sorted = [...missing].sort((a, b) => a - b);
  const tokens: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const n = sorted[i];
    if (n === prev + 1) { prev = n; continue; }
    tokens.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = n; prev = n;
  }
  if (tokens.length <= 5) return tokens.join(', ');
  return `${tokens.slice(0, 5).join(', ')} + ${tokens.length - 5} more`;
}

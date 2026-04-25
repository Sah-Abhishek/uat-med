import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Chart } from '../../entities/chart.entity';
import { ChartAllocation } from '../../entities/chart-allocation.entity';
import { ChartFeedback } from '../../entities/chart-feedback.entity';
import { ChartMilestone, ChartStatus, Priority } from '../../common/enums';
import { Role } from '../../common/enums/roles.enum';
import { AuthenticatedUser } from '../../common/types/request-user.type';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { QueryChartsDto } from './dto/query-charts.dto';
import { UpdateChartDto } from './dto/update-chart.dto';
import { BulkModifyDto } from './dto/bulk-modify.dto';
import { ChartFeedbackDto, UpdateFeedbackDto } from './dto/chart-feedback.dto';

/** Allowed milestone transitions (see §21.2 of the spec). */
const TRANSITIONS: Record<ChartMilestone, ChartMilestone[]> = {
  [ChartMilestone.READY_TO_CODE]:       [ChartMilestone.CODING_IN_PROGRESS],
  [ChartMilestone.CODING_IN_PROGRESS]:  [ChartMilestone.CODING_DONE, ChartMilestone.READY_TO_CODE],
  [ChartMilestone.CODING_DONE]:         [ChartMilestone.READY_TO_AUDIT],
  [ChartMilestone.READY_TO_AUDIT]:      [ChartMilestone.AUDIT_IN_PROGRESS],
  [ChartMilestone.AUDIT_IN_PROGRESS]:   [ChartMilestone.AUDIT_DONE, ChartMilestone.READY_TO_CODE],
  [ChartMilestone.AUDIT_DONE]:          [ChartMilestone.CLOSED],
  [ChartMilestone.CLOSED]:              [],
};

// Simple in-memory column preferences keyed by userId. A real impl would persist in Redis or `user_preferences`.
const columnPrefs = new Map<number, Array<{ key: string; visible: boolean }>>();
// Active timers keyed by `${userId}:${chartId}`.
const activeTimers = new Map<string, number>();

@Injectable()
export class ChartsService {
  constructor(
    @InjectRepository(Chart) private readonly charts: Repository<Chart>,
    @InjectRepository(ChartAllocation) private readonly allocations: Repository<ChartAllocation>,
    @InjectRepository(ChartFeedback) private readonly feedbacks: Repository<ChartFeedback>,
  ) {}

  async list(q: QueryChartsDto, user: AuthenticatedUser) {
    const qb = this.charts.createQueryBuilder('c');

    // Role-scoped visibility: coders / auditors see only their own queue.
    if (user.role === Role.CODER) qb.andWhere('c.allocated_coder_id = :uid', { uid: user.id });
    if (user.role === Role.AUDITOR) qb.andWhere('c.allocated_auditor_id = :uid', { uid: user.id });

    if (q.priority) qb.andWhere('c.priority = :p', { p: q.priority });
    if (q.worklistId) qb.andWhere('c.worklist_id = :w', { w: q.worklistId });
    if (q.serialFrom) qb.andWhere('c.serial_no >= :sf', { sf: q.serialFrom });
    if (q.serialTo) qb.andWhere('c.serial_no <= :st', { st: q.serialTo });
    if (q.chartNo) qb.andWhere('c.chart_no ILIKE :cn', { cn: `%${q.chartNo}%` });
    if (q.chartStatus) qb.andWhere('c.chart_status = :cs', { cs: q.chartStatus });
    if (q.milestone) qb.andWhere('c.milestone = :m', { m: q.milestone });
    if (q.allocatedUserId) qb.andWhere('(c.allocated_coder_id = :au OR c.allocated_auditor_id = :au)', { au: q.allocatedUserId });
    if (q.primarySpecialityId) qb.innerJoin('worklists', 'w', 'w.id = c.worklist_id').andWhere('w.primary_speciality_id = :ps', { ps: q.primarySpecialityId });
    if (q.receivedDateFrom || q.receivedDateTo) {
      qb.innerJoin('worklists', 'wl', 'wl.id = c.worklist_id');
      if (q.receivedDateFrom) qb.andWhere('wl.received_date >= :rdf', { rdf: q.receivedDateFrom });
      if (q.receivedDateTo) qb.andWhere('wl.received_date <= :rdt', { rdt: q.receivedDateTo });
    }

    qb.orderBy(`c.${q.sortBy ?? 'createdAt'}`, q.sortDir === 'asc' ? 'ASC' : 'DESC');
    qb.skip((q.page - 1) * q.pageSize).take(q.pageSize);

    const [items, total] = await qb.getManyAndCount();
    return new PaginatedResponseDto(items, total, q.page, q.pageSize);
  }

  async summary(user: AuthenticatedUser) {
    const qb = this.charts.createQueryBuilder('c');
    if (user.role === Role.CODER) qb.andWhere('c.allocated_coder_id = :uid', { uid: user.id });
    if (user.role === Role.AUDITOR) qb.andWhere('c.allocated_auditor_id = :uid', { uid: user.id });

    const priorityRows = await qb.clone()
      .select('c.priority', 'priority').addSelect('COUNT(*)', 'count').groupBy('c.priority').getRawMany();
    const milestoneRows = await qb.clone()
      .select('c.milestone', 'milestone').addSelect('COUNT(*)', 'count').groupBy('c.milestone').getRawMany();

    const pc = { critical: 0, high: 0, medium: 0, low: 0, finalized: 0 };
    priorityRows.forEach(r => { pc[String(r.priority).toLowerCase() as keyof typeof pc] = Number(r.count); });
    const ms = { readyToCode: 0, codingDone: 0, readyToAudit: 0, auditDone: 0 };
    milestoneRows.forEach(r => {
      if (r.milestone === ChartMilestone.READY_TO_CODE) ms.readyToCode = Number(r.count);
      if (r.milestone === ChartMilestone.CODING_DONE) ms.codingDone = Number(r.count);
      if (r.milestone === ChartMilestone.READY_TO_AUDIT) ms.readyToAudit = Number(r.count);
      if (r.milestone === ChartMilestone.AUDIT_DONE) ms.auditDone = Number(r.count);
    });
    return { priorityCounts: pc, milestones: ms, statusToday: { complete: 0, incomplete: 0 } };
  }

  async detail(id: number) {
    const c = await this.charts.findOne({ where: { id } });
    if (!c) throw new NotFoundException();
    return c;
  }

async update(id: number, dto: UpdateChartDto) {
  const c = await this.charts.findOne({ where: { id } });
  if (!c) throw new NotFoundException();

  // Merge customFields rather than overwrite — preserves other keys.
  const { customFields, ...flat } = dto;
  Object.assign(c, flat);
  if (customFields) {
    c.customFields = { ...(c.customFields ?? {}), ...customFields };
  }
  return this.charts.save(c);
}

  async transition(id: number, body: { milestone: string; chartStatus?: string }) {
    const c = await this.charts.findOne({ where: { id } });
    if (!c) throw new NotFoundException();
    const target = body.milestone as ChartMilestone;
    if (!TRANSITIONS[c.milestone]?.includes(target)) {
      throw new BadRequestException({ error: { code: 'bad_request', message: `Transition from ${c.milestone} to ${target} is not allowed.` } });
    }
    c.milestone = target;
    if (body.chartStatus) c.chartStatus = body.chartStatus as ChartStatus;
    await this.charts.save(c);
    return { id: c.id, milestone: c.milestone, chartStatus: c.chartStatus };
  }

  async startTimer(id: number, user: AuthenticatedUser) {
    const c = await this.charts.findOne({ where: { id } });
    if (!c) throw new NotFoundException();
    const now = Date.now();
    activeTimers.set(`${user.id}:${id}`, now);
    if (c.milestone === ChartMilestone.READY_TO_CODE && user.role === Role.CODER) {
      c.milestone = ChartMilestone.CODING_IN_PROGRESS;
      await this.charts.save(c);
    } else if (c.milestone === ChartMilestone.READY_TO_AUDIT && user.role === Role.AUDITOR) {
      c.milestone = ChartMilestone.AUDIT_IN_PROGRESS;
      await this.charts.save(c);
    }
    return { chartId: id, startedAt: new Date(now).toISOString() };
  }

  async stopTimer(id: number, user: AuthenticatedUser) {
    const key = `${user.id}:${id}`;
    const started = activeTimers.get(key);
    if (!started) throw new BadRequestException({ error: { code: 'bad_request', message: 'No active timer for this user/chart.' } });
    activeTimers.delete(key);
    return { chartId: id, elapsedMs: Date.now() - started };
  }

  async bulkModify(dto: BulkModifyDto) {
    const updatedCharts = await this.charts.findBy({ id: In(dto.chartIds) });
    if (updatedCharts.length === 0) return { updated: 0 };
    for (const c of updatedCharts) {
      if (dto.priority) c.priority = dto.priority as Priority;
      if (dto.allocation && dto.allocation.action !== 'NONE') {
        if (dto.allocation.action === 'ALLOCATE_CODING' && dto.allocation.assigneeId) c.allocatedCoderId = dto.allocation.assigneeId;
        if (dto.allocation.action === 'ALLOCATE_AUDITING' && dto.allocation.assigneeId) c.allocatedAuditorId = dto.allocation.assigneeId;
        if (dto.allocation.action === 'REALLOCATE_TO_ORIGINAL_CODER') c.allocatedCoderId = c.originalCoderId ?? c.allocatedCoderId;
      }
    }
    await this.charts.save(updatedCharts);
    return { updated: updatedCharts.length };
  }

  async selfAllocate(chartIds: number[], user: AuthenticatedUser) {
    const cs = await this.charts.findBy({ id: In(chartIds) });
    for (const c of cs) {
      if (user.role === Role.CODER) c.allocatedCoderId = user.id;
      else if (user.role === Role.AUDITOR) c.allocatedAuditorId = user.id;
    }
    await this.charts.save(cs);
    return { allocated: cs.length };
  }

  async bulkDelete(chartIds: number[]) {
    const result = await this.charts.softDelete(chartIds);
    return { deleted: result.affected ?? 0 };
  }

  getColumns(userId: number) {
    return { columns: columnPrefs.get(userId) ?? [] };
  }

  saveColumns(userId: number, columns: Array<{ key: string; visible: boolean }>) {
    columnPrefs.set(userId, columns);
    return { columns };
  }

  async listFeedback(chartId: number) {
    return this.feedbacks.find({ where: { chartId }, order: { createdAt: 'DESC' } });
  }

  async addFeedback(chartId: number, dto: ChartFeedbackDto, auditorId: number) {
    const chart = await this.charts.findOne({ where: { id: chartId } });
    if (!chart) throw new NotFoundException();
    const f = await this.feedbacks.save(this.feedbacks.create({ chartId, auditorId, ...dto }));
    return { id: f.id };
  }

  async updateFeedback(feedbackId: number, dto: UpdateFeedbackDto) {
    const f = await this.feedbacks.findOne({ where: { id: feedbackId } });
    if (!f) throw new NotFoundException();
    Object.assign(f, dto);
    return this.feedbacks.save(f);
  }
}

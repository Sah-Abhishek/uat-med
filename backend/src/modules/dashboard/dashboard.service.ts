import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Worklist } from '../../entities/worklist.entity';
import { Chart } from '../../entities/chart.entity';
import { ChartMilestone, ChartStatus, WorklistStatus } from '../../common/enums';
import { AuthenticatedUser } from '../../common/types/request-user.type';
import { Role } from '../../common/enums/roles.enum';

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Worklist) private readonly worklists: Repository<Worklist>,
    @InjectRepository(Chart) private readonly charts: Repository<Chart>,
  ) {}

  private scopeCharts(qb: any, q: { clientId?: number; locationId?: number }) {
    if (q.clientId || q.locationId) {
      qb.innerJoin('worklists', 'w', 'w.id = c.worklist_id');
      if (q.clientId) qb.andWhere('w.client_id = :c', { c: q.clientId });
      if (q.locationId) qb.andWhere('w.location_id = :l', { l: q.locationId });
    }
    return qb;
  }

  async milestones(q: { clientId?: number; locationId?: number }) {
    const qb = this.charts.createQueryBuilder('c').select('c.milestone', 'm').addSelect('COUNT(*)', 'n').groupBy('c.milestone');
    const rows = await this.scopeCharts(qb, q).getRawMany();
    const map = Object.fromEntries(rows.map(r => [r.m, Number(r.n)]));
    return {
      inProgress: (map[ChartMilestone.CODING_IN_PROGRESS] ?? 0) + (map[ChartMilestone.AUDIT_IN_PROGRESS] ?? 0),
      readyToCode: map[ChartMilestone.READY_TO_CODE] ?? 0,
      readyToAllocate: 0, // computed by product from chart/worklist state; zeroed here
    };
  }

  async status(q: { clientId?: number; locationId?: number }) {
    const qb = this.charts.createQueryBuilder('c').select('c.chart_status', 's').addSelect('COUNT(*)', 'n').groupBy('c.chart_status');
    const rows = await this.scopeCharts(qb, q).getRawMany();
    const map = Object.fromEntries(rows.map(r => [r.s, Number(r.n)]));
    return { complete: map[ChartStatus.COMPLETE] ?? 0, incomplete: map[ChartStatus.INCOMPLETE] ?? 0 };
  }

  async unallocated(q: { clientId?: number; locationId?: number }) {
    const [totalWorklists, unallocWorklists] = await Promise.all([
      this.worklists.count({ where: q.clientId ? { clientId: q.clientId, ...(q.locationId ? { locationId: q.locationId } : {}) } : {} }),
      this.worklists.count({ where: { status: WorklistStatus.OPEN, ...(q.clientId ? { clientId: q.clientId } : {}), ...(q.locationId ? { locationId: q.locationId } : {}) } }),
    ]);
    const chartQb = this.charts.createQueryBuilder('c');
    const totalCharts = await this.scopeCharts(chartQb.clone(), q).getCount();
    const unallocCharts = await this.scopeCharts(chartQb.clone().where({ allocatedCoderId: IsNull() }), q).getCount();
    return { worklists: { unallocated: unallocWorklists, total: totalWorklists }, charts: { unallocated: unallocCharts, total: totalCharts } };
  }

  async allocationStats(_q: any) {
    const byMilestone = await this.charts.createQueryBuilder('c')
      .select('c.milestone', 'milestone').addSelect('COUNT(*)', 'count').groupBy('c.milestone').getRawMany();
    return {
      chartsByMilestone: byMilestone.map(r => ({ milestone: r.milestone, count: Number(r.count) })),
      chartCompletion: { incomplete: 0, complete: 0, open: 0 },
      qualityControl: { feedbackProvided: 0, agree: 0, feedbackRejected: 0, feedbackImplemented: 0, unaudited: 0 },
      progressToDate: [],
      worklistByStatus: [],
    };
  }

  async self(user: AuthenticatedUser) {
    const qb = this.charts.createQueryBuilder('c');
    if (user.role === Role.CODER) qb.where('c.allocated_coder_id = :uid', { uid: user.id });
    else if (user.role === Role.AUDITOR) qb.where('c.allocated_auditor_id = :uid', { uid: user.id });
    const readyToCode = await qb.clone().andWhere('c.milestone = :m', { m: ChartMilestone.READY_TO_CODE }).getCount();
    const readyToAudit = await qb.clone().andWhere('c.milestone = :m', { m: ChartMilestone.READY_TO_AUDIT }).getCount();
    return {
      readyToCode, codingDoneToday: 0, readyToAudit, auditDoneToday: 0,
      completeToday: 0, incompleteToday: 0,
      inProgressChart: null, inProgressStartedAt: null,
    };
  }
}

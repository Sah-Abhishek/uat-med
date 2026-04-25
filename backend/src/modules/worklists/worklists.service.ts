import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, In } from 'typeorm';
import { Worklist } from '../../entities/worklist.entity';
import { Chart } from '../../entities/chart.entity';
import { ChartAllocation } from '../../entities/chart-allocation.entity';
import { WorklistStatus } from '../../common/enums';
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
    const qb = this.worklists.createQueryBuilder('w');
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
    return new PaginatedResponseDto(items, total, q.page, q.pageSize);
  }

  async statusSummary() {
    const rows = await this.worklists
      .createQueryBuilder('w').select('w.status', 'status').addSelect('COUNT(*)', 'count').groupBy('w.status').getRawMany();
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
    const w = this.worklists.create({
      worklistNumber: dto.worklistNumber,
      clientId: dto.clientId,
      locationId: dto.locationId,
      primarySpecialityId: dto.primarySpecialityId,
      processId: dto.processId,
      dateOfService: dto.dateOfService,
      receivedDate: dto.receivedDate,
      totalCharts: dto.numberOfCharts ?? 0,
      createdBy: userId,
    });
    const saved = await this.worklists.save(w);
    return { id: saved.id, worklistNumber: saved.worklistNumber, status: saved.status, totalCharts: saved.totalCharts, importTaskId: null };
  }

  async detail(id: number) {
    const w = await this.worklists.findOne({ where: { id }, relations: ['client', 'location', 'primarySpeciality'] });
    if (!w) throw new NotFoundException();
    const counts = await this.charts.createQueryBuilder('c')
      .select('COUNT(*)', 'total')
      .addSelect(`SUM(CASE WHEN c.allocated_coder_id IS NOT NULL OR c.allocated_auditor_id IS NOT NULL THEN 1 ELSE 0 END)`, 'allocated')
      .addSelect(`SUM(CASE WHEN c.milestone = 'READY_TO_CODE' THEN 1 ELSE 0 END)`, 'notStarted')
      .addSelect(`SUM(CASE WHEN c.milestone IN ('CODING_IN_PROGRESS','AUDIT_IN_PROGRESS') THEN 1 ELSE 0 END)`, 'inProgress')
      .addSelect(`SUM(CASE WHEN c.milestone = 'CLOSED' THEN 1 ELSE 0 END)`, 'closed')
      .where('c.worklist_id = :id', { id })
      .getRawOne();
    const total = Number(counts.total ?? 0);
    const allocated = Number(counts.allocated ?? 0);
    return {
      id: w.id,
      worklistNumber: w.worklistNumber,
      client: w.client ? { id: w.client.id, name: w.client.name } : null,
      location: w.location ? { id: w.location.id, name: w.location.name } : null,
      primarySpeciality: w.primarySpeciality ? { id: w.primarySpeciality.id, name: w.primarySpeciality.name } : null,
      dateOfService: w.dateOfService,
      receivedDate: w.receivedDate,
      status: w.status,
      netChange: w.netChange,
      chartSummary: {
        total,
        allocated,
        unallocated: total - allocated,
        notStarted: Number(counts.notStarted ?? 0),
        inProgress: Number(counts.inProgress ?? 0),
        closed: Number(counts.closed ?? 0),
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

    return this.ds.transaction(async manager => {
      let allocated = 0;
      for (const a of dto.allocations) {
        const charts = await manager.getRepository(Chart).find({
          where: { worklistId: id, serialNo: In(range(a.from, a.to)) },
        });
        for (const c of charts) {
          if (a.role === 'CODER') { c.allocatedCoderId = a.assigneeId; c.originalCoderId ??= a.assigneeId; }
          else { c.allocatedAuditorId = a.assigneeId; c.originalAuditorId ??= a.assigneeId; }
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

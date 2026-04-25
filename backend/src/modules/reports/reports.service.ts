import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuid } from 'uuid';

import { ReportTemplate } from '../../entities/report-template.entity';
import { Chart } from '../../entities/chart.entity';
import { Role } from '../../common/enums/roles.enum';
import { AuthenticatedUser } from '../../common/types/request-user.type';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { QueryReportDto } from './dto/query-report.dto';
import { SaveTemplateDto } from './dto/save-template.dto';

const FIELD_CATALOG = [
  { key: 'worklistNumber', label: 'Worklist Number', filterable: true, sortable: true },
  { key: 'serialNo', label: 'S.No', filterable: true, sortable: true },
  { key: 'chartNo', label: 'Chart Number', filterable: true, sortable: true },
  { key: 'mrNumber', label: 'MR Number', filterable: true, sortable: true },
  { key: 'client', label: 'Client', filterable: true, sortable: true },
  { key: 'location', label: 'Location', filterable: true, sortable: true },
  { key: 'primarySpeciality', label: 'Primary Speciality', filterable: true, sortable: true },
  { key: 'process', label: 'Process', filterable: true, sortable: true },
  { key: 'dos', label: 'Date of Service', filterable: true, sortable: true },
  { key: 'receivedDate', label: 'Received Date', filterable: true, sortable: true },
  { key: 'dateOfCompletion', label: 'Date of Completion', filterable: true, sortable: true },
  { key: 'allocatedCoder', label: 'Allocated Coder', filterable: true, sortable: true },
  { key: 'allocatedAuditor', label: 'Allocated Auditor', filterable: true, sortable: true },
  { key: 'milestone', label: 'Milestone', filterable: true, sortable: true },
  { key: 'chartStatus', label: 'Chart Status', filterable: true, sortable: true },
  { key: 'priority', label: 'Priority', filterable: true, sortable: true },
  { key: 'holdReason', label: 'Hold Reason', filterable: true, sortable: true },
  { key: 'responsibleParty', label: 'Responsible Party', filterable: true, sortable: true },
  { key: 'primaryHealthPlan', label: 'Primary Health Plan', filterable: true, sortable: true },
  { key: 'primaryDiagnosis', label: 'Primary Diagnosis', filterable: true, sortable: true },
  { key: 'secondaryDiagnoses', label: 'Secondary Dx', filterable: false, sortable: false },
  { key: 'emLevel', label: 'E/M Level', filterable: true, sortable: true },
  { key: 'qcStatus', label: 'QC Status', filterable: true, sortable: true },
  { key: 'feedbackCategory', label: 'Feedback Category', filterable: true, sortable: true },
  { key: 'feedbackType', label: 'Feedback Type', filterable: true, sortable: true },
];

// In-memory task store for exports (replace with Redis/BullMQ job state in production).
const exportTasks = new Map<string, { status: string; rowsExported?: number; downloadUrl?: string }>();

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(ReportTemplate) private readonly templates: Repository<ReportTemplate>,
    @InjectRepository(Chart) private readonly charts: Repository<Chart>,
  ) {}

  fields() { return FIELD_CATALOG; }

  async runQuery(dto: QueryReportDto, _user: AuthenticatedUser) {
    const valid = new Set(FIELD_CATALOG.map(f => f.key));
    const columns = dto.columns.filter(c => valid.has(c));
    const qb = this.charts.createQueryBuilder('c');

    // Basic filter translation; a real impl joins per-field.
    if (dto.filters?.client) qb.innerJoin('worklists', 'w', 'w.id = c.worklist_id').andWhere('w.client_id = :c', { c: dto.filters.client });
    if (Array.isArray(dto.filters?.milestone)) qb.andWhere('c.milestone IN (:...ms)', { ms: dto.filters.milestone });
    if (dto.filters?.receivedDate?.from) qb.andWhere('w.received_date >= :rf', { rf: dto.filters.receivedDate.from });
    if (dto.filters?.receivedDate?.to) qb.andWhere('w.received_date <= :rt', { rt: dto.filters.receivedDate.to });

    if (dto.sort?.length) {
      dto.sort.forEach((s, i) => qb[i === 0 ? 'orderBy' : 'addOrderBy'](`c.${s.key}`, s.dir === 'desc' ? 'DESC' : 'ASC'));
    }

    qb.skip(((dto.page ?? 1) - 1) * (dto.pageSize ?? 50)).take(dto.pageSize ?? 50);

    const [items, total] = await qb.getManyAndCount();
    const rows = items.map((c: any) => columns.map(col => c[col] ?? null));
    return { columns, rows, total, page: dto.page ?? 1, pageSize: dto.pageSize ?? 50 };
  }

  async listTemplates(page: number, pageSize: number, user: AuthenticatedUser) {
    const qb = this.templates.createQueryBuilder('t')
      .where('t.owner_id = :uid OR t.is_shared = true', { uid: user.id })
      .orderBy('t.updated_at', 'DESC')
      .skip((page - 1) * pageSize).take(pageSize);
    const [items, total] = await qb.getManyAndCount();
    return new PaginatedResponseDto(items, total, page, pageSize);
  }

  async createTemplate(dto: SaveTemplateDto, ownerId: number) {
    const t = await this.templates.save(this.templates.create({
      ownerId,
      name: dto.name,
      columns: dto.columns,
      filters: dto.filters ?? {},
      isShared: dto.isShared ?? false,
    }));
    return { id: t.id };
  }

  async getTemplate(id: number, user: AuthenticatedUser) {
    const t = await this.templates.findOne({ where: { id } });
    if (!t) throw new NotFoundException();
    if (!t.isShared && t.ownerId !== user.id && user.role !== Role.ADMIN && user.role !== Role.MANAGER) {
      throw new ForbiddenException();
    }
    return t;
  }

  async updateTemplate(id: number, dto: SaveTemplateDto, user: AuthenticatedUser) {
    const t = await this.templates.findOne({ where: { id } });
    if (!t) throw new NotFoundException();
    if (t.ownerId !== user.id && user.role !== Role.ADMIN) throw new ForbiddenException();
    Object.assign(t, dto);
    return this.templates.save(t);
  }

  async deleteTemplate(id: number, user: AuthenticatedUser) {
    const t = await this.templates.findOne({ where: { id } });
    if (!t) throw new NotFoundException();
    if (t.ownerId !== user.id && user.role !== Role.ADMIN) throw new ForbiddenException();
    await this.templates.delete(id);
    return { status: 'deleted' };
  }

  startExport(_dto: QueryReportDto) {
    const taskId = `bull-rpt-${uuid()}`;
    exportTasks.set(taskId, { status: 'queued' });
    // In production, enqueue a BullMQ job here.
    setTimeout(() => {
      exportTasks.set(taskId, { status: 'done', rowsExported: 0, downloadUrl: `https://example.invalid/reports/${taskId}.xlsx` });
    }, 100);
    return { taskId, status: 'queued' };
  }

  exportStatus(taskId: string) {
    const t = exportTasks.get(taskId);
    if (!t) throw new NotFoundException();
    return { taskId, ...t };
  }
}

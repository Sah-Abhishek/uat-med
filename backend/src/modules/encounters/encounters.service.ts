import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Chart } from '../../entities/chart.entity';
import { QueryEncountersDto } from './dto/query-encounters.dto';

export interface EncounterRow {
  /** AI-pipeline encounter id (custom_fields.aiPrediction.encounterId). */
  encounterId: string;
  subSpeciality: string | null;
  client: string | null;
  location: string | null;
  /** Timestamp the chart's coding finished (CODING_DONE); null if not yet coded. */
  codingCompletedAt: Date | null;
}

@Injectable()
export class EncountersService {
  constructor(@InjectRepository(Chart) private readonly charts: Repository<Chart>) {}

  /**
   * List AI-pipeline encounters with the chart's sub-speciality, client,
   * location and date-of-coding. Only charts that actually carry an encounter id
   * are returned; soft-deleted charts and charts orphaned by a soft-deleted
   * worklist are excluded. Paginated and newest-coded first.
   */
  async list(q: QueryEncountersDto) {
    const base = this.charts
      .createQueryBuilder('c')
      .innerJoin('c.worklist', 'w')
      .leftJoin('w.client', 'client')
      .leftJoin('w.location', 'location')
      .leftJoin('w.subSpeciality', 'subSpeciality')
      // Only charts that carry an AI-pipeline encounter id. (Soft-deleted charts
      // are filtered out automatically by TypeORM's delete-date column.)
      .where("(c.custom_fields #>> '{aiPrediction,encounterId}') IS NOT NULL")
      // Skip charts orphaned by a soft-deleted worklist.
      .andWhere('w.deleted_at IS NULL');

    if (q.from) base.andWhere('c.coding_completed_at::date >= :from', { from: q.from });
    if (q.to) base.andWhere('c.coding_completed_at::date <= :to', { to: q.to });
    if (q.clientId) base.andWhere('w.client_id = :clientId', { clientId: q.clientId });
    if (q.locationId) base.andWhere('w.location_id = :locationId', { locationId: q.locationId });
    if (q.subSpecialityId) base.andWhere('w.sub_speciality_id = :ssid', { ssid: q.subSpecialityId });

    const total = await base.clone().getCount();

    const items = await base
      .clone()
      .select("c.custom_fields #>> '{aiPrediction,encounterId}'", 'encounterId')
      .addSelect('subSpeciality.name', 'subSpeciality')
      .addSelect('client.name', 'client')
      .addSelect('location.name', 'location')
      .addSelect('c.coding_completed_at', 'codingCompletedAt')
      // Newest coding first; uncoded (null date) last. Tie-break on id so paging
      // is stable.
      .orderBy('c.coding_completed_at', 'DESC', 'NULLS LAST')
      .addOrderBy('c.id', 'DESC')
      .offset((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .getRawMany<EncounterRow>();

    return { items, total, page: q.page, pageSize: q.pageSize };
  }
}

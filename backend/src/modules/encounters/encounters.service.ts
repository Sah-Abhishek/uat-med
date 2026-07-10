import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Chart } from '../../entities/chart.entity';
import { User } from '../../entities/user.entity';
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

/** One uploaded clinical document exposed on the encounter-detail response. */
export interface EncounterDocument {
  filename: string | null;
  /** Directly-viewable (public-read) S3/MinIO url of the document. */
  url: string;
}

/** Full detail for a single encounter id (see GET /encounters/:encounterId). */
export interface EncounterDetail {
  encounterId: string;
  client: string | null;
  location: string | null;
  primarySpeciality: string | null;
  subSpeciality: string | null;
  documents: EncounterDocument[];
  /** Date the chart's coding finished (CODING_DONE); null if not yet coded. */
  codingCompletedAt: Date | null;
  /** The worklist's received date (YYYY-MM-DD); null if unset. */
  receivedDate: string | null;
  /** Name of the coder currently allocated to the chart; null if unallocated. */
  coder: string | null;
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

  /**
   * Full detail for a single encounter id: client, location, primary & sub
   * speciality, uploaded-document urls, date of coding, the worklist's received
   * date and the allocated coder's name. This is a *global* lookup — it is NOT
   * scoped to the caller's client/location/role, so any authenticated user can
   * resolve any encounter id. Charts orphaned by a soft-deleted worklist stay
   * hidden. Throws 404 if no chart carries the id.
   */
  async detail(encounterId: string): Promise<EncounterDetail> {
    const eid = (encounterId ?? '').trim();
    if (!eid) {
      throw new NotFoundException({
        error: { code: 'not_found', message: 'Encounter id is required.' },
      });
    }

    const row = await this.charts
      .createQueryBuilder('c')
      .innerJoin('c.worklist', 'w')
      .leftJoin('w.client', 'client')
      .leftJoin('w.location', 'location')
      .leftJoin('w.primarySpeciality', 'primarySpeciality')
      .leftJoin('w.subSpeciality', 'subSpeciality')
      // allocated_coder_id is a plain column (no ORM relation), so join the
      // users table on it directly to resolve the coder's display name.
      .leftJoin(User, 'coder', 'coder.id = c.allocated_coder_id')
      .where("(c.custom_fields #>> '{aiPrediction,encounterId}') = :eid", { eid })
      // Skip charts orphaned by a soft-deleted worklist (soft-deleted charts are
      // dropped automatically by TypeORM's delete-date column).
      .andWhere('w.deleted_at IS NULL')
      .select("c.custom_fields #>> '{aiPrediction,encounterId}'", 'encounterId')
      .addSelect('client.name', 'client')
      .addSelect('location.name', 'location')
      .addSelect('primarySpeciality.name', 'primarySpeciality')
      .addSelect('subSpeciality.name', 'subSpeciality')
      // Free-text fallback for tenants that store the sub-speciality on
      // custom_fields rather than as a structured worklist column.
      .addSelect("c.custom_fields ->> 'subSpeciality'", 'subSpecialityText')
      .addSelect("c.custom_fields -> 'uploadedDocs'", 'uploadedDocs')
      .addSelect('c.coding_completed_at', 'codingCompletedAt')
      .addSelect('w.received_date', 'receivedDate')
      .addSelect('coder.full_name', 'coder')
      // Deterministic pick if two charts ever share an encounter id: newest coded.
      .orderBy('c.coding_completed_at', 'DESC', 'NULLS LAST')
      .addOrderBy('c.id', 'DESC')
      .getRawOne<Record<string, unknown>>();

    if (!row) {
      throw new NotFoundException({
        error: { code: 'not_found', message: `No chart found for encounter id "${eid}".` },
      });
    }

    const subSpecialityText = row.subSpecialityText;
    return {
      encounterId: row.encounterId as string,
      client: (row.client as string | null) ?? null,
      location: (row.location as string | null) ?? null,
      primarySpeciality: (row.primarySpeciality as string | null) ?? null,
      subSpeciality:
        (row.subSpeciality as string | null) ??
        (typeof subSpecialityText === 'string' ? subSpecialityText : null),
      documents: this.mapDocuments(row.uploadedDocs),
      codingCompletedAt: (row.codingCompletedAt as Date | null) ?? null,
      receivedDate: (row.receivedDate as string | null) ?? null,
      coder: (row.coder as string | null) ?? null,
    };
  }

  /**
   * Normalize the JSONB `uploadedDocs` blob into `{ filename, url }[]`. The pg
   * driver usually hands back a parsed array, but tolerate a JSON string too;
   * drop any entry without a usable url.
   */
  private mapDocuments(raw: unknown): EncounterDocument[] {
    let arr: unknown[] = [];
    if (Array.isArray(raw)) arr = raw;
    else if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) arr = parsed;
      } catch {
        /* malformed blob — treat as no documents */
      }
    }
    return arr
      .filter(
        (d): d is Record<string, unknown> =>
          !!d && typeof d === 'object' && typeof (d as Record<string, unknown>).url === 'string',
      )
      .map((d) => ({
        filename: typeof d.filename === 'string' ? d.filename : null,
        url: d.url as string,
      }));
  }
}

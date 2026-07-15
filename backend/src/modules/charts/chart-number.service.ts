import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { Chart } from '../../entities/chart.entity';
import { Client } from '../../entities/client.entity';
import { Worklist } from '../../entities/worklist.entity';

/**
 * A live chart already holding a chart number, carrying just enough context to
 * name it in an error message ("… already exists in worklist 8942").
 */
interface TakenChart {
  id: number;
  dos: string | null;
  /** Empty for a row accepted earlier in the current batch — it has no worklist yet. */
  worklistNumber: string;
  /** True when the clash is with another row of the same upload, not a saved chart. */
  sameBatch?: boolean;
}

/** Trim + case-fold, so "abc123" and "ABC123 " are the same chart number. */
function key(chartNo: string): string {
  return chartNo.trim().toLowerCase();
}

/**
 * Reduce a date of service to a bare 'YYYY-MM-DD' calendar day, the only form
 * two DOS values are ever compared in.
 *
 * The Date branch matters: node-postgres materialises a bare `date` column as a
 * Date at LOCAL midnight, so toISOString() would report the previous day for any
 * timezone east of UTC — and a DOS that silently shifts by a day makes every
 * repeat look like a different date, quietly waving through the exact
 * chart-#/DOS duplicate this service exists to refuse. Read the local calendar
 * fields instead. (The query below also casts to text so this rarely fires.)
 */
function normalizeDos(dos: unknown): string | null {
  if (!dos) return null;
  if (dos instanceof Date) {
    const y = dos.getFullYear();
    const m = String(dos.getMonth() + 1).padStart(2, '0');
    const d = String(dos.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(dos).trim();
  return s ? s.slice(0, 10) : null;
}

/**
 * Answers "may this chart number be used?" for one client, over one batch of
 * work. Built by ChartNumberService.forClient/forWorklist/forChart, which
 * pre-loads every live chart already using the incoming numbers — so checking N
 * rows costs one query, not N.
 *
 * Stateful by design: `remember()` folds an accepted row back into the taken
 * set, which is what stops a single Excel file from inserting the same chart
 * number twice (the DB snapshot alone cannot catch intra-batch repeats).
 */
export class ChartNumberChecker {
  constructor(
    private readonly clientName: string,
    private readonly allowDuplicates: boolean,
    private readonly taken: Map<string, TakenChart[]>,
  ) {}

  /** True when this client re-uses chart numbers across dates of service. */
  get duplicatesAllowed(): boolean {
    return this.allowDuplicates;
  }

  /**
   * The rule in one sentence, for callers that reject a whole batch and need to
   * state it once rather than repeat it per offending row.
   */
  get ruleSummary(): string {
    return this.allowDuplicates
      ? `${this.clientName} allows a repeated chart number only on a different date of service.`
      : `Chart numbers must be unique for ${this.clientName}.`;
  }

  /**
   * Where a given chart number is already in use ("worklist 8942" / "earlier in
   * this upload"), for compact per-row callouts in a batch-level error. Read it
   * at the moment the clash is detected — later `remember()` calls for the same
   * number would otherwise widen the answer.
   */
  locus(chartNo: string | null | undefined): string {
    const no = (chartNo ?? '').trim();
    if (!no) return '';
    const hits = this.taken.get(key(no));
    return hits && hits.length > 0 ? this.where(hits) : '';
  }

  /**
   * Returns an explicit, user-facing reason the chart number can't be used, or
   * null when it's free. Blank chart numbers are always allowed — they're the
   * placeholder rows created with a worklist, not real duplicates.
   */
  check(chartNo: string | null | undefined, dos: string | null | undefined): string | null {
    const no = (chartNo ?? '').trim();
    if (!no) return null;

    const hits = this.taken.get(key(no));
    if (!hits || hits.length === 0) return null;

    if (!this.allowDuplicates) {
      return `Chart number ${no} already exists for ${this.clientName} (${this.where(hits)}). Chart numbers must be unique for this client.`;
    }

    // Exception client: a repeat is fine, but only on a different date of
    // service — so a row with no DOS can't be told apart from what's there.
    const on = normalizeDos(dos);
    if (!on) {
      return `Chart number ${no} already exists for ${this.clientName} (${this.where(hits)}). ${this.clientName} allows a repeated chart number only on a different date of service, so this chart needs a date of service.`;
    }

    const clash = hits.find((h) => h.dos === on);
    if (clash) {
      return `Chart number ${no} already exists for ${this.clientName} with date of service ${on} (${this.where([clash])}). A repeated chart number must have a different date of service.`;
    }
    return null;
  }

  /** Fold an accepted row into the taken set so later rows in the same batch see it. */
  remember(chartNo: string | null | undefined, dos: string | null | undefined): void {
    const no = (chartNo ?? '').trim();
    if (!no) return;
    const k = key(no);
    const list = this.taken.get(k) ?? [];
    list.push({ id: 0, dos: normalizeDos(dos), worklistNumber: '', sameBatch: true });
    this.taken.set(k, list);
  }

  /**
   * Where the clash lives, in words the reader can act on: "worklist 8942",
   * "worklists 8942, 3214", or "earlier in this upload" for a row repeated
   * within the batch being imported (which has no worklist number yet).
   */
  private where(hits: TakenChart[]): string {
    const parts: string[] = [];
    const names = [...new Set(hits.filter((h) => !h.sameBatch).map((h) => h.worklistNumber))];
    if (names.length > 0) {
      const shown = names.slice(0, 3).join(', ');
      const more = names.length > 3 ? ` +${names.length - 3} more` : '';
      parts.push(`${names.length === 1 ? 'worklist' : 'worklists'} ${shown}${more}`);
    }
    if (hits.some((h) => h.sameBatch)) parts.push('earlier in this upload');
    return parts.join(', ');
  }
}

/**
 * Enforces chart-number uniqueness across a client's worklists.
 *
 * The rule (User-facing): a chart number identifies one encounter, so it may
 * appear only once per client. Clients flagged `allowDuplicateChartNumbers`
 * (Seminole, Taylor regional Profee) re-use an account number per encounter
 * date, so for them a repeat is allowed provided the date of service differs;
 * an exact chart-#/DOS repeat is still refused.
 *
 * Scope is the CLIENT, not the worklist: the same encounter double-imported into
 * two worklists is precisely the duplicate this exists to catch. Charts carry no
 * client_id, so every lookup joins through worklists.
 *
 * Soft-deleted charts, and charts orphaned under a soft-deleted worklist, are
 * invisible here — a deleted chart must not reserve its number forever.
 */
@Injectable()
export class ChartNumberService {
  constructor(private readonly ds: DataSource) {}

  /** Build a checker for `clientId`, pre-loading only the numbers in `chartNos`. */
  async forClient(
    clientId: number,
    chartNos: Array<string | null | undefined>,
    opts: { manager?: EntityManager; excludeChartId?: number } = {},
  ): Promise<ChartNumberChecker> {
    const mgr = opts.manager ?? this.ds.manager;

    const client = await mgr.getRepository(Client).findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException({ error: { code: 'not_found', message: 'Client not found.' } });

    const wanted = [...new Set(chartNos.map((n) => (n ?? '').trim()).filter(Boolean).map(key))];
    if (wanted.length === 0) {
      return new ChartNumberChecker(client.name, client.allowDuplicateChartNumbers ?? false, new Map());
    }

    const qb = mgr
      .getRepository(Chart)
      .createQueryBuilder('c')
      .innerJoin(Worklist, 'w', 'w.id = c.worklist_id')
      .select('c.id', 'id')
      .addSelect('c.chart_no', 'chart_no')
      // ::text keeps Postgres' own calendar day — never a Date the driver would
      // rebuild at local midnight (see normalizeDos).
      .addSelect('c.dos::text', 'dos')
      .addSelect('w.worklist_number', 'worklist_number')
      .where('w.client_id = :clientId', { clientId })
      .andWhere('c.deleted_at IS NULL')
      .andWhere('w.deleted_at IS NULL')
      .andWhere('LOWER(c.chart_no) IN (:...nos)', { nos: wanted });
    if (opts.excludeChartId) qb.andWhere('c.id <> :self', { self: opts.excludeChartId });

    const rows = await qb.getRawMany<{ id: string; chart_no: string; dos: unknown; worklist_number: string }>();

    const taken = new Map<string, TakenChart[]>();
    for (const r of rows) {
      const k = key(r.chart_no);
      const list = taken.get(k) ?? [];
      list.push({ id: Number(r.id), dos: normalizeDos(r.dos), worklistNumber: r.worklist_number });
      taken.set(k, list);
    }
    return new ChartNumberChecker(client.name, client.allowDuplicateChartNumbers ?? false, taken);
  }

  /** Same, resolving the client from a worklist. */
  async forWorklist(
    worklistId: number,
    chartNos: Array<string | null | undefined>,
    opts: { manager?: EntityManager; excludeChartId?: number } = {},
  ): Promise<ChartNumberChecker> {
    const mgr = opts.manager ?? this.ds.manager;
    const w = await mgr.getRepository(Worklist).findOne({ where: { id: worklistId } });
    if (!w) throw new NotFoundException({ error: { code: 'not_found', message: 'Worklist not found.' } });
    return this.forClient(w.clientId, chartNos, opts);
  }

  /** Same, resolving the client from a chart — and excluding that chart from its own check. */
  async forChart(
    chartId: number,
    chartNos: Array<string | null | undefined>,
    opts: { manager?: EntityManager } = {},
  ): Promise<ChartNumberChecker> {
    const mgr = opts.manager ?? this.ds.manager;
    const c = await mgr.getRepository(Chart).findOne({ where: { id: chartId } });
    if (!c) throw new NotFoundException({ error: { code: 'not_found', message: 'Chart not found.' } });
    return this.forWorklist(c.worklistId, chartNos, { ...opts, excludeChartId: chartId });
  }
}

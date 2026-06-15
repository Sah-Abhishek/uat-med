import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

export interface IcdCodeHit {
  code: string;
  description: string;
  isBillable: boolean;
}

/**
 * Read-only lookups against the ICD-10-CM reference database (icd10cm).
 *
 * This DB is separate from the app's primary database — it lives on the same
 * Postgres instance but is owned by a different role (icd_user). The app's DB
 * user has been granted read-only SELECT on it, so we open a small dedicated
 * pool here rather than wiring it into the main TypeORM connection (which runs
 * with synchronize on in non-prod and must never touch reference tables).
 */
@Injectable()
export class IcdCodesService implements OnModuleDestroy {
  private readonly logger = new Logger(IcdCodesService.name);
  private readonly pool: Pool;
  /** Memoized newest fiscal year present in `codes` — the set we search. */
  private latestFiscalYear: Promise<number> | null = null;

  constructor(private readonly cfg: ConfigService) {
    this.pool = new Pool({
      host: this.cfg.get<string>('ICD_REF_DB_HOST'),
      port: this.cfg.get<number>('ICD_REF_DB_PORT'),
      user: this.cfg.get<string>('ICD_REF_DB_USERNAME'),
      password: this.cfg.get<string>('ICD_REF_DB_PASSWORD'),
      database: this.cfg.get<string>('ICD_REF_DB_NAME'),
      ssl:
        this.cfg.get<string>('ICD_REF_DB_SSL') === 'true'
          ? { rejectUnauthorized: false }
          : false,
      max: this.cfg.get<number>('ICD_REF_DB_POOL_SIZE') ?? 5,
      // Lookups are tiny; fail fast rather than hang the autocomplete request.
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    });
    // A pool-level error (e.g. a backend dropping an idle connection) would
    // otherwise crash the process — log and swallow; the next query reconnects.
    this.pool.on('error', (err) =>
      this.logger.error(`icd10cm pool error: ${err.message}`),
    );
  }

  async onModuleDestroy() {
    await this.pool.end().catch(() => undefined);
  }

  /**
   * Prefix-search the latest-fiscal-year ICD-10-CM codes. Matches the typed
   * prefix against the code both as stored (E11.9) and dot-stripped (E119),
   * so a coder gets hits whether or not they type the decimal point.
   * Returns [] for anything shorter than 2 chars.
   */
  async search(rawQuery: string, limit = 10): Promise<IcdCodeHit[]> {
    const q = (rawQuery ?? '').trim().toUpperCase();
    if (q.length < 2) return [];

    const lim = Math.min(Math.max(Math.trunc(limit) || 10, 1), 25);
    const dotted = escapeLike(q);
    const dotless = escapeLike(q.replace(/\./g, ''));
    const fiscalYear = await this.getLatestFiscalYear();

    const { rows } = await this.pool.query<{
      code: string;
      description: string;
      is_billable: boolean;
    }>(
      `
      SELECT code, description, is_billable
      FROM codes
      WHERE fiscal_year = $1
        AND (
          code ILIKE $2 || '%' ESCAPE '\\'
          OR replace(code, '.', '') ILIKE $3 || '%' ESCAPE '\\'
        )
      ORDER BY code
      LIMIT $4
      `,
      [fiscalYear, dotted, dotless, lim],
    );

    return rows.map((r) => ({
      code: r.code,
      description: r.description,
      isBillable: r.is_billable,
    }));
  }

  /** Memoized: the reference set is republished rarely, so one lookup per
   * process lifetime is plenty. A failed lookup is not cached. */
  private getLatestFiscalYear(): Promise<number> {
    if (!this.latestFiscalYear) {
      this.latestFiscalYear = this.pool
        .query<{ max: number | null }>('SELECT max(fiscal_year)::int AS max FROM codes')
        .then((r) => r.rows[0]?.max ?? new Date().getFullYear())
        .catch((err) => {
          this.latestFiscalYear = null; // allow a retry on the next request
          throw err;
        });
    }
    return this.latestFiscalYear;
  }
}

/** Escape LIKE/ILIKE wildcards so a user typing `%` or `_` matches literally
 * (paired with `ESCAPE '\'` in the query). */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

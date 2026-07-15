import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `clients.allow_duplicate_chart_numbers`, the per-client switch behind the
 * chart-number uniqueness rule (see ChartNumberService).
 *
 *   false (default) — a chart number may appear at most once per client.
 *   true            — the same chart number may repeat, but only on a DIFFERENT
 *                     date of service. An exact chart-#/DOS repeat is still barred.
 *
 * Seeded true for the two clients that bill this way (Seminole, Taylor regional
 * Profee), matched case-insensitively so a stray capital can't silently leave a
 * client on the strict rule. Every other client — TRH included — stays strict.
 *
 * Also adds a functional index on LOWER(chart_no): the uniqueness lookup matches
 * case-insensitively, which the plain btree on chart_no cannot serve.
 *
 * SCHEMA-ONLY + a targeted data seed; additive and idempotent. Deliberately does
 * NOT add a UNIQUE constraint — existing data already violates the rule (one
 * client has 72 charts duplicated across test worklists), so uniqueness is
 * enforced in application code on write and existing rows are left alone.
 */
export class AddAllowDuplicateChartNumbersToClients1715002300000 implements MigrationInterface {
  name = 'AddAllowDuplicateChartNumbersToClients1715002300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE clients ADD COLUMN IF NOT EXISTS allow_duplicate_chart_numbers BOOLEAN NOT NULL DEFAULT false;`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_charts_chart_no_lower ON charts (LOWER(chart_no));`,
    );
    await queryRunner.query(
      `UPDATE clients SET allow_duplicate_chart_numbers = true
        WHERE LOWER(name) IN ('seminole', 'taylor regional profee');`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_charts_chart_no_lower;`);
    await queryRunner.query(
      `ALTER TABLE clients DROP COLUMN IF EXISTS allow_duplicate_chart_numbers;`,
    );
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Service Line feature.
 *
 * 1. Creates the `service_lines` global lookup table.
 * 2. Seeds the 22 business-defined service lines IN ORDER (sort_order drives
 *    every picker — the list is intentionally NOT alphabetical).
 * 3. Adds the nullable `service_line_id` FK to `charts` (ON DELETE SET NULL so
 *    a chart survives if its service line is ever removed).
 *
 * Idempotent throughout (IF NOT EXISTS / ON CONFLICT DO NOTHING) — dev runs
 * synchronize:true so the table/column may already exist; the seed is safe to
 * re-run and new lines can be appended later by editing the catalogue, not code.
 */
export class AddServiceLines1715000600000 implements MigrationInterface {
  name = 'AddServiceLines1715000600000';

  // The canonical catalogue, in display order. Adding more later is a row
  // insert (via the admin UI or another idempotent migration) — no schema work.
  private static readonly SEED = [
    'ED Facility',
    'I&I Administration',
    'ED Profee',
    'EM-OP',
    'EM-IP',
    'EM Procedure',
    'Ob-gyn',
    'New born',
    'SDS',
    'General Surgery',
    'WHC Profee/ facility',
    'ASC',
    'Ancillary',
    'IP-DRG',
    'HCC',
    'PT/OT',
    'Surgical Pathology',
    'Macular Pathology',
    'Radiology',
    'IVR',
    'Denial/ Edits',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "service_lines" (
        "id"         bigserial PRIMARY KEY,
        "name"       varchar(120) NOT NULL,
        "code"       varchar(32),
        "sort_order" integer NOT NULL DEFAULT 0,
        "is_active"  boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_service_lines_name" UNIQUE ("name"),
        CONSTRAINT "UQ_service_lines_code" UNIQUE ("code")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_service_lines_sort_order" ON "service_lines" ("sort_order")`,
    );

    // Seed in order. ON CONFLICT keeps it idempotent; sort_order is refreshed so
    // re-running after a manual reorder restores the canonical sequence.
    for (let i = 0; i < AddServiceLines1715000600000.SEED.length; i++) {
      await queryRunner.query(
        `INSERT INTO "service_lines" ("name", "sort_order", "is_active")
         VALUES ($1, $2, true)
         ON CONFLICT ("name") DO UPDATE SET "sort_order" = EXCLUDED."sort_order"`,
        [AddServiceLines1715000600000.SEED[i], (i + 1) * 10],
      );
    }

    // Add the FK column to charts (nullable — service line is optional).
    await queryRunner.query(
      `ALTER TABLE "charts" ADD COLUMN IF NOT EXISTS "service_line_id" bigint`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_charts_service_line_id" ON "charts" ("service_line_id")`,
    );
    // Guard the FK behind a catalog check so re-runs don't error on an existing
    // constraint (ADD CONSTRAINT has no IF NOT EXISTS).
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_charts_service_line'
        ) THEN
          ALTER TABLE "charts"
            ADD CONSTRAINT "FK_charts_service_line"
            FOREIGN KEY ("service_line_id") REFERENCES "service_lines"("id")
            ON DELETE SET NULL;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "charts" DROP CONSTRAINT IF EXISTS "FK_charts_service_line"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_charts_service_line_id"`);
    await queryRunner.query(`ALTER TABLE "charts" DROP COLUMN IF EXISTS "service_line_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "service_lines"`);
  }
}

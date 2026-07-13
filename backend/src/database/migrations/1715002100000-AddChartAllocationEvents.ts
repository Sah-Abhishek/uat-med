import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `chart_allocation_events` — the append-only audit trail of coder/auditor
 * allocation changes (see ChartAllocationEvent). SCHEMA-ONLY: adds a new table and
 * indexes; touches no existing rows. History accrues from deploy onward (past
 * reallocations that predate this table are not backfilled — their actor is
 * unknowable). Idempotent (IF NOT EXISTS).
 */
export class AddChartAllocationEvents1715002100000 implements MigrationInterface {
  name = 'AddChartAllocationEvents1715002100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS chart_allocation_events (
        id            BIGSERIAL PRIMARY KEY,
        chart_id      BIGINT NOT NULL,
        role          VARCHAR(16) NOT NULL,
        from_user_id  BIGINT,
        to_user_id    BIGINT,
        changed_by_id BIGINT,
        source        VARCHAR(40) NOT NULL,
        milestone     VARCHAR(40),
        chart_status  VARCHAR(16),
        worklist_id   BIGINT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_cae_chart_id ON chart_allocation_events (chart_id);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_cae_changed_by_id ON chart_allocation_events (changed_by_id);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_cae_created_at ON chart_allocation_events (created_at);`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS chart_allocation_events;`);
  }
}

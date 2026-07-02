import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds `charts.last_coder_allocated_at` — the timestamp of the MOST RECENT
 * coder (re)allocation. Going forward it's stamped by every coder-allocation
 * path (worklist allocate, bulk-modify, self-take); this migration backfills
 * historic rows from `chart_allocations` (the latest CODER allocation per
 * chart). Charts allocated only via paths that never wrote an allocation row
 * (legacy self/bulk allocations) stay NULL and are simply left untouched by
 * the priority sweep until they're next allocated.
 *
 * This column drives the auto priority buckets in ChartPriorityService:
 * allocated today → LOW, aged past today without coding progress → MEDIUM.
 *
 * Idempotent: dev runs with synchronize:true, so the column/index may already
 * exist by the time this migration runs.
 */
export class AddLastCoderAllocatedAt1715001800000 implements MigrationInterface {
  name = 'AddLastCoderAllocatedAt1715001800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('charts', 'last_coder_allocated_at'))) {
      await queryRunner.addColumn(
        'charts',
        new TableColumn({
          name: 'last_coder_allocated_at',
          type: 'timestamptz',
          isNullable: true,
        }),
      );
    }

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_charts_last_coder_allocated_at"
      ON charts (last_coder_allocated_at)
    `);

    // Backfill from the latest recorded CODER allocation per chart.
    await queryRunner.query(`
      UPDATE charts c
      SET last_coder_allocated_at = a.last_at
      FROM (
        SELECT chart_id, MAX(allocated_at) AS last_at
        FROM chart_allocations
        WHERE role = 'CODER'
        GROUP BY chart_id
      ) a
      WHERE a.chart_id = c.id
        AND c.last_coder_allocated_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_charts_last_coder_allocated_at"`);
    if (await queryRunner.hasColumn('charts', 'last_coder_allocated_at')) {
      await queryRunner.dropColumn('charts', 'last_coder_allocated_at');
    }
  }
}

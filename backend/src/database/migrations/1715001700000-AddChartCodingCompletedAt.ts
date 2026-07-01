import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds `charts.coding_completed_at` — the date/time a chart's coding finished
 * (milestone reached CODING_DONE). Going forward it's stamped by
 * Chart.setMilestone; this migration also backfills historic rows.
 *
 * Backfill is exact for charts currently AT CODING_DONE (their
 * `milestone_changed_at` IS the coding-completed moment) and a best-effort
 * approximation for charts already past coding (READY_TO_AUDIT … CLOSED), where
 * `milestone_changed_at` reflects a later transition — the closest signal we
 * still have. Rows that never reached coding stay NULL.
 */
export class AddChartCodingCompletedAt1715001700000 implements MigrationInterface {
  name = 'AddChartCodingCompletedAt1715001700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'charts',
      new TableColumn({
        name: 'coding_completed_at',
        type: 'timestamptz',
        isNullable: true,
      }),
    );

    await queryRunner.query(`
      UPDATE charts
      SET coding_completed_at = milestone_changed_at
      WHERE coding_completed_at IS NULL
        AND milestone_changed_at IS NOT NULL
        AND milestone IN (
          'CODING_DONE', 'READY_TO_AUDIT', 'AUDIT_IN_PROGRESS', 'AUDIT_DONE', 'CLOSED'
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('charts', 'coding_completed_at');
  }
}

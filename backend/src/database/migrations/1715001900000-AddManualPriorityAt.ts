import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds `charts.manual_priority_at` — non-null iff the `priority` column is an
 * ACTIVE manual override (User Manual §7.3). Priority is otherwise computed per
 * viewer from milestone × chart-status × QC-status × received-date
 * (see priority-rules.ts), so the stored value is ignored unless overridden.
 *
 * SCHEMA-ONLY: this migration adds a nullable column and does NOT modify any
 * existing rows. Every chart therefore starts with no override, so the new
 * computed rules apply to all charts from deploy onward. (Existing stored
 * priorities — including CRITICAL — become inert and are recomputed on read;
 * this is intentional and touches no data.) Manual overrides accrue only from
 * new user actions after deploy.
 *
 * Idempotent (dev runs with synchronize:true may add the column first).
 */
export class AddManualPriorityAt1715001900000 implements MigrationInterface {
  name = 'AddManualPriorityAt1715001900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('charts', 'manual_priority_at'))) {
      await queryRunner.addColumn(
        'charts',
        new TableColumn({ name: 'manual_priority_at', type: 'timestamptz', isNullable: true }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('charts', 'manual_priority_at')) {
      await queryRunner.dropColumn('charts', 'manual_priority_at');
    }
  }
}

import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

/**
 * Persists coder/auditor work-timer sessions so a running timer survives a
 * backend restart and elapsed time is durably stored. Replaces the old
 * in-memory Map in ChartsService.
 */
export class CreateChartTimeLogs1715001100000 implements MigrationInterface {
  name = 'CreateChartTimeLogs1715001100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'chart_time_logs',
        columns: [
          { name: 'id', type: 'bigint', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'chart_id', type: 'bigint' },
          { name: 'user_id', type: 'bigint' },
          { name: 'kind', type: 'text', default: `'CODING'` },
          { name: 'started_at', type: 'timestamptz' },
          { name: 'stopped_at', type: 'timestamptz', isNullable: true },
          { name: 'elapsed_ms', type: 'bigint', isNullable: true },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'chart_time_logs',
      new TableForeignKey({
        name: 'FK_chart_time_logs_chart',
        columnNames: ['chart_id'],
        referencedTableName: 'charts',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'chart_time_logs',
      new TableForeignKey({
        name: 'FK_chart_time_logs_user',
        columnNames: ['user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createIndex(
      'chart_time_logs',
      new TableIndex({ name: 'IDX_chart_time_logs_chart', columnNames: ['chart_id'] }),
    );
    await queryRunner.createIndex(
      'chart_time_logs',
      new TableIndex({ name: 'IDX_chart_time_logs_user', columnNames: ['user_id'] }),
    );

    // At most one OPEN (running) session per user — the single-active-chart
    // rule, enforced at the DB level. activeTimer()/startTimer() rely on this.
    await queryRunner.createIndex(
      'chart_time_logs',
      new TableIndex({
        name: 'UQ_chart_time_logs_open_per_user',
        columnNames: ['user_id'],
        isUnique: true,
        where: '"stopped_at" IS NULL',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('chart_time_logs', true);
  }
}

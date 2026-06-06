import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

export class CreateChartCodeDecisionDrafts1715000600000 implements MigrationInterface {
  name = 'CreateChartCodeDecisionDrafts1715000600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'chart_code_decision_drafts',
        columns: [
          { name: 'id', type: 'bigint', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'chart_id', type: 'bigint' },
          { name: 'user_id', type: 'bigint' },
          { name: 'payload', type: 'jsonb' },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'chart_code_decision_drafts',
      new TableForeignKey({
        name: 'FK_chart_code_decision_drafts_chart',
        columnNames: ['chart_id'],
        referencedTableName: 'charts',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'chart_code_decision_drafts',
      new TableForeignKey({
        name: 'FK_chart_code_decision_drafts_user',
        columnNames: ['user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    // One draft per (chart, user) — the autosave upsert conflicts on this.
    await queryRunner.createIndex(
      'chart_code_decision_drafts',
      new TableIndex({
        name: 'UQ_chart_code_decision_drafts_chart_user',
        columnNames: ['chart_id', 'user_id'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'chart_code_decision_drafts',
      new TableIndex({
        name: 'IDX_chart_code_decision_drafts_chart',
        columnNames: ['chart_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('chart_code_decision_drafts', true);
  }
}

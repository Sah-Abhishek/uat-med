import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

export class CreateChartCodeAudits1715001500000 implements MigrationInterface {
  name = 'CreateChartCodeAudits1715001500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'chart_code_audits',
        columns: [
          { name: 'id', type: 'bigint', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'chart_id', type: 'bigint' },
          { name: 'chart_code_decision_id', type: 'bigint', isNullable: true },
          { name: 'code_type', type: 'varchar', length: '16' },
          { name: 'code_value', type: 'varchar', length: '32' },
          { name: 'verdict', type: 'varchar', length: '16' },
          { name: 'feedback_category', type: 'varchar', length: '255', isNullable: true },
          { name: 'feedback_text', type: 'varchar', length: '2000', isNullable: true },
          { name: 'audited_by_user_id', type: 'bigint' },
          { name: 'audited_at', type: 'timestamptz' },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'chart_code_audits',
      new TableForeignKey({
        name: 'FK_chart_code_audits_chart',
        columnNames: ['chart_id'],
        referencedTableName: 'charts',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'chart_code_audits',
      new TableForeignKey({
        name: 'FK_chart_code_audits_decision',
        columnNames: ['chart_code_decision_id'],
        referencedTableName: 'chart_code_decisions',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.createForeignKey(
      'chart_code_audits',
      new TableForeignKey({
        name: 'FK_chart_code_audits_user',
        columnNames: ['audited_by_user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    // One audit per (chart, code_type, code_value) — the submit upserts on this.
    await queryRunner.createIndex(
      'chart_code_audits',
      new TableIndex({
        name: 'UQ_chart_code_audits_chart_type_value',
        columnNames: ['chart_id', 'code_type', 'code_value'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'chart_code_audits',
      new TableIndex({
        name: 'IDX_chart_code_audits_chart_type',
        columnNames: ['chart_id', 'code_type'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('chart_code_audits', true);
  }
}

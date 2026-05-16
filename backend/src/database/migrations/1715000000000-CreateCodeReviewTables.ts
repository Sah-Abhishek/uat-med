import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

export class CreateCodeReviewTables1715000000000 implements MigrationInterface {
  name = 'CreateCodeReviewTables1715000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'code_review_reasons',
        columns: [
          { name: 'id', type: 'bigint', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'client_id', type: 'bigint' },
          { name: 'location_id', type: 'bigint' },
          { name: 'code_type', type: 'varchar', length: '16' },
          { name: 'action', type: 'varchar', length: '8' },
          { name: 'text', type: 'varchar', length: '255' },
          { name: 'display_order', type: 'int', default: 0 },
          { name: 'is_active', type: 'boolean', default: true },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'code_review_reasons',
      new TableIndex({
        name: 'UQ_code_review_reasons_scope_text',
        columnNames: ['client_id', 'location_id', 'code_type', 'action', 'text'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'code_review_reasons',
      new TableIndex({
        name: 'IDX_code_review_reasons_lookup',
        columnNames: ['client_id', 'location_id', 'code_type', 'action', 'is_active'],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'chart_code_decisions',
        columns: [
          { name: 'id', type: 'bigint', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'chart_id', type: 'bigint' },
          { name: 'code_type', type: 'varchar', length: '16' },
          { name: 'code_value', type: 'varchar', length: '32' },
          { name: 'original_description', type: 'varchar', length: '500', isNullable: true },
          { name: 'decision', type: 'varchar', length: '16' },
          { name: 'edited_code', type: 'varchar', length: '32', isNullable: true },
          { name: 'edited_description', type: 'varchar', length: '500', isNullable: true },
          { name: 'reason_dropdown', type: 'varchar', length: '255', isNullable: true },
          { name: 'reason_text', type: 'varchar', length: '2000', isNullable: true },
          { name: 'decided_by_user_id', type: 'bigint' },
          { name: 'decided_at', type: 'timestamptz' },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'chart_code_decisions',
      new TableForeignKey({
        name: 'FK_chart_code_decisions_chart',
        columnNames: ['chart_id'],
        referencedTableName: 'charts',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'chart_code_decisions',
      new TableForeignKey({
        name: 'FK_chart_code_decisions_user',
        columnNames: ['decided_by_user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
      }),
    );

    await queryRunner.createIndex(
      'chart_code_decisions',
      new TableIndex({
        name: 'UQ_chart_code_decisions_per_code',
        columnNames: ['chart_id', 'code_type', 'code_value'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'chart_code_decisions',
      new TableIndex({
        name: 'IDX_chart_code_decisions_chart_type',
        columnNames: ['chart_id', 'code_type'],
      }),
    );

    await queryRunner.createIndex(
      'chart_code_decisions',
      new TableIndex({
        name: 'IDX_chart_code_decisions_chart',
        columnNames: ['chart_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('chart_code_decisions', true);
    await queryRunner.dropTable('code_review_reasons', true);
  }
}

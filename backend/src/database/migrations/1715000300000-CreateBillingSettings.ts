import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateBillingSettings1715000300000 implements MigrationInterface {
  name = 'CreateBillingSettings1715000300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'billing_settings',
        columns: [
          { name: 'id', type: 'int', isPrimary: true },
          { name: 'rate_per_document', type: 'numeric', precision: 12, scale: 2, default: 0 },
          { name: 'currency', type: 'varchar', length: '8', default: "'USD'" },
          { name: 'updated_by_user_id', type: 'bigint', isNullable: true },
          { name: 'updated_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('billing_settings', true);
  }
}

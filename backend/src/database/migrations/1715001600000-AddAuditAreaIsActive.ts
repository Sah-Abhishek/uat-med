import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddAuditAreaIsActive1715001600000 implements MigrationInterface {
  name = 'AddAuditAreaIsActive1715001600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'audit_areas',
      new TableColumn({
        name: 'is_active',
        type: 'boolean',
        isNullable: false,
        default: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('audit_areas', 'is_active');
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDateOfServiceToToWorklists1715000200000 implements MigrationInterface {
  name = 'AddDateOfServiceToToWorklists1715000200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Idempotent: dev uses synchronize:true so the column may already
    // exist by the time this runs. Prod runs only this migration.
    await queryRunner.query(
      `ALTER TABLE "worklists" ADD COLUMN IF NOT EXISTS "date_of_service_to" date`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "worklists" DROP COLUMN IF EXISTS "date_of_service_to"`,
    );
  }
}

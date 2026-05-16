import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPredictedCodeIdToDecisions1715000100000 implements MigrationInterface {
  name = 'AddPredictedCodeIdToDecisions1715000100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Idempotent: dev uses synchronize:true so the column may already
    // exist by the time this runs. Prod runs only this migration.
    await queryRunner.query(
      `ALTER TABLE "chart_code_decisions" ADD COLUMN IF NOT EXISTS "predicted_code_id" varchar(64)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chart_code_decisions" DROP COLUMN IF EXISTS "predicted_code_id"`,
    );
  }
}

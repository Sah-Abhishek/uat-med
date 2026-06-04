import { MigrationInterface, QueryRunner } from 'typeorm';

export class WidenDecisionDescriptions1715000500000 implements MigrationInterface {
  name = 'WidenDecisionDescriptions1715000500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // WHY: original_description / edited_description were varchar(500), but the
    // AI orchestrator returns code long-descriptions that can exceed 500 chars.
    // The frontend forwards them verbatim, so submitting a chart's decisions
    // failed with "decisions.N.originalDescription must be shorter than or equal
    // to 500 characters" (and the whole batch was rejected). Widening to `text`
    // removes the storage cap entirely so this can never recur regardless of how
    // long a description the gateway sends. text and varchar share the same
    // on-disk representation in Postgres, so this is a metadata-only change.
    //
    // Idempotent: dev uses synchronize:true so the columns may already be text.
    await queryRunner.query(
      `ALTER TABLE "chart_code_decisions" ALTER COLUMN "original_description" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "chart_code_decisions" ALTER COLUMN "edited_description" TYPE text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Truncate on the way back down so the varchar(500) cast can't fail on rows
    // that were stored with longer descriptions while the column was text.
    await queryRunner.query(
      `ALTER TABLE "chart_code_decisions" ALTER COLUMN "original_description" TYPE varchar(500) USING left("original_description", 500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "chart_code_decisions" ALTER COLUMN "edited_description" TYPE varchar(500) USING left("edited_description", 500)`,
    );
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class WidenChartEmLevel1715001300000 implements MigrationInterface {
  name = 'WidenChartEmLevel1715001300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // WHY: em_level was varchar(8), but users / the AI tag legitimately put
    // longer values in the EM field. Saving a chart then failed with
    // "emLevel must be shorter than or equal to 8 characters" (and at the DB
    // layer would otherwise raise "value too long for type character varying(8)").
    // Widening to `text` removes the cap entirely so it can never recur. text and
    // varchar share the same on-disk representation in Postgres — metadata-only.
    //
    // Idempotent: dev uses synchronize:true so the column may already be text.
    await queryRunner.query(
      `ALTER TABLE "charts" ALTER COLUMN "em_level" TYPE text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Truncate on the way back down so the varchar(8) cast can't fail on rows
    // stored with longer values while the column was text.
    await queryRunner.query(
      `ALTER TABLE "charts" ALTER COLUMN "em_level" TYPE varchar(8) USING left("em_level", 8)`,
    );
  }
}

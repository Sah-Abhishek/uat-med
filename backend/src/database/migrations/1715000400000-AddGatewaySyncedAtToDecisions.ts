import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGatewaySyncedAtToDecisions1715000400000 implements MigrationInterface {
  name = 'AddGatewaySyncedAtToDecisions1715000400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Idempotent: dev uses synchronize:true so the column may already exist.
    //
    // WHY: a decision's sync status was inferred solely from
    // gateway_correction_id. But ACCEPT is audit-only on the gateway and never
    // returns a correction_id, so accepted codes that WERE forwarded looked
    // identical to ones that were never sent ("Local only"). gateway_synced_at
    // records the moment a row was successfully forwarded — for every action,
    // ACCEPT included — so we can tell "accept reached the AI" from "accept
    // never forwarded".
    await queryRunner.query(
      `ALTER TABLE "chart_code_decisions" ADD COLUMN IF NOT EXISTS "gateway_synced_at" timestamptz`,
    );
    // Any row that already has a correction_id was demonstrably forwarded;
    // stamp it so the two signals stay consistent and the backfill script's
    // `gateway_synced_at IS NULL` guard doesn't re-send it.
    await queryRunner.query(
      `UPDATE "chart_code_decisions"
         SET "gateway_synced_at" = COALESCE("updated_at", "decided_at")
       WHERE "gateway_correction_id" IS NOT NULL
         AND "gateway_synced_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chart_code_decisions" DROP COLUMN IF EXISTS "gateway_synced_at"`,
    );
  }
}

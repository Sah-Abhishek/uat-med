import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Clients and Locations were previously created with `code = ''` when the
 * Team Lead form left the field blank. Postgres UNIQUE allows many NULLs but
 * only one empty string, so the second blank-code row tripped a 23505 error
 * surfaced as "Unique constraint violation." Convert any pre-existing
 * empty-string codes to NULL so the new code path (which inserts NULL for
 * blank input) stays consistent with historical rows.
 */
export class NullifyEmptyClientCodes1715000300000 implements MigrationInterface {
  name = 'NullifyEmptyClientCodes1715000300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "clients"   SET "code" = NULL WHERE "code" = ''`);
    await queryRunner.query(`UPDATE "locations" SET "code" = NULL WHERE "code" = ''`);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // No-op: we don't restore empty strings, the original state was the bug.
  }
}

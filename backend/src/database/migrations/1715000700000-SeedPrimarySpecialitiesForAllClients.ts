import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill a standard set of primary specialities onto EVERY existing client.
 *
 * Primary specialities are client-scoped (`primary_specialities` is unique on
 * client_id + name), so this CROSS JOINs the catalogue against `clients` and
 * inserts one row per (client, name). ON CONFLICT DO NOTHING keeps it
 * idempotent — re-running, or running after a client already has some of these,
 * never duplicates or errors.
 *
 * NOTE: this only covers clients that exist at migration time. New clients
 * created afterwards do not automatically receive these — that would be a
 * client-creation hook, not a one-off backfill.
 */
export class SeedPrimarySpecialitiesForAllClients1715000700000 implements MigrationInterface {
  name = 'SeedPrimarySpecialitiesForAllClients1715000700000';

  // Business-defined primary specialities to add to every client.
  private static readonly SEED = [
    'ED Facility',
    'EM',
    'SDS',
    'General Surgery',
    'Wound Care',
    'ASC',
    'Ancillary',
    'IP-DRG',
    'HCC',
    'PT/OT',
    'Pathology',
    'Radiology',
    'Interventional Radiology',
    'Denial/ Edits',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const values = SeedPrimarySpecialitiesForAllClients1715000700000.SEED
      .map((_, i) => `($${i + 1})`)
      .join(', ');

    // One row per (existing client × seed name); skip any that already exist.
    await queryRunner.query(
      `INSERT INTO "primary_specialities" ("client_id", "name", "is_active")
       SELECT c."id", v."name", true
       FROM "clients" c
       CROSS JOIN (VALUES ${values}) AS v("name")
       ON CONFLICT ("client_id", "name") DO NOTHING`,
      SeedPrimarySpecialitiesForAllClients1715000700000.SEED,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const placeholders = SeedPrimarySpecialitiesForAllClients1715000700000.SEED
      .map((_, i) => `$${i + 1}`)
      .join(', ');

    // Revert removes these names from every client. Heads up: if a client had
    // one of these specialities before the backfill, this still drops it.
    await queryRunner.query(
      `DELETE FROM "primary_specialities" WHERE "name" IN (${placeholders})`,
      SeedPrimarySpecialitiesForAllClients1715000700000.SEED,
    );
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill a standard set of sub-specialities onto EVERY existing location
 * (i.e. every client + location pair).
 *
 * Sub-specialities are location-scoped (`sub_specialities` is unique on
 * location_id + name), so this CROSS JOINs the catalogue against `locations`
 * and inserts one row per (location, name). ON CONFLICT DO NOTHING keeps it
 * idempotent — re-running, or running after a location already has some of
 * these, never duplicates or errors.
 *
 * NOTE: this only covers locations that exist at migration time. New locations
 * created afterwards do not automatically receive these — that would be a
 * location-creation hook, not a one-off backfill.
 */
export class SeedSubSpecialitiesForAllLocations1715001000000 implements MigrationInterface {
  name = 'SeedSubSpecialitiesForAllLocations1715001000000';

  // Business-defined sub-specialities to add to every location.
  private static readonly SEED = [
    'ED Facility',
    'ED Profee',
    'EM - OP',
    'EM-IP',
    'Ob-gyn',
    'New born',
    'SDS',
    'General Surgery',
    'WHC Profee / facility',
    'ASC',
    'Ancillary',
    'IP-DRG',
    'HCC',
    'PT/OT',
    'Surgical Pathology',
    'Macular Pathology',
    'Radiology',
    'IVR',
    'Denial/ Edits',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const values = SeedSubSpecialitiesForAllLocations1715001000000.SEED
      .map((_, i) => `($${i + 1})`)
      .join(', ');

    // One row per (existing location × seed name); skip any that already exist.
    await queryRunner.query(
      `INSERT INTO "sub_specialities" ("location_id", "name", "is_active")
       SELECT l."id", v."name", true
       FROM "locations" l
       CROSS JOIN (VALUES ${values}) AS v("name")
       ON CONFLICT ("location_id", "name") DO NOTHING`,
      SeedSubSpecialitiesForAllLocations1715001000000.SEED,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const placeholders = SeedSubSpecialitiesForAllLocations1715001000000.SEED
      .map((_, i) => `$${i + 1}`)
      .join(', ');

    // Revert removes these names from every location. Heads up: if a location
    // had one of these sub-specialities before the backfill, this still drops
    // it. Worklists referencing a dropped row keep their (now-dangling) id —
    // the column is a loose bigint with no DB-level FK constraint.
    await queryRunner.query(
      `DELETE FROM "sub_specialities" WHERE "name" IN (${placeholders})`,
      SeedSubSpecialitiesForAllLocations1715001000000.SEED,
    );
  }
}

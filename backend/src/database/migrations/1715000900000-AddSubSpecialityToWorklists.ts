import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the `sub_speciality_id` column to `worklists`.
 *
 * Nullable on purpose: worklists created before sub-speciality existed have no
 * value, and a NOT NULL column would fail to add against those rows. New
 * worklists are forced to supply one at the API layer (CreateWorklistDto), so
 * the field is effectively mandatory going forward without breaking history.
 *
 * Sub-specialities are location-scoped (`sub_specialities` is unique on
 * location_id + name), so this id pairs with the worklist's location_id.
 */
export class AddSubSpecialityToWorklists1715000900000 implements MigrationInterface {
  name = 'AddSubSpecialityToWorklists1715000900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "worklists" ADD COLUMN IF NOT EXISTS "sub_speciality_id" bigint`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_worklists_sub_speciality_id" ON "worklists" ("sub_speciality_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_worklists_sub_speciality_id"`);
    await queryRunner.query(`ALTER TABLE "worklists" DROP COLUMN IF EXISTS "sub_speciality_id"`);
  }
}

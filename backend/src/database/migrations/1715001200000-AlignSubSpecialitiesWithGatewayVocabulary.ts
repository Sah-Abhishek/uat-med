import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Align two sub-speciality names with the AI gateway's GET /api/specialities
 * vocabulary so the speciality-tuned RAG actually fires.
 *
 * We forward a chart's sub-speciality verbatim as `sub_speciality`; the gateway
 * matches case/space-sensitively. Two names we seeded drifted by a single space
 * and so never matched — those encounters silently fell back to default coding:
 *
 *   'EM - OP'               -> 'EM -OP'                (drop the space after '-')
 *   'WHC Profee / facility' -> 'WHC Profee/ facility'  (drop the space before '/')
 *
 * Sub-specialities are location-scoped and unique on (location_id, name).
 * Worklists reference `sub_speciality_id`, so renaming the row keeps every
 * pointer intact — no repoint needed (unlike the primary-speciality remap in
 * 1715000800000, which merged into duplicate rows).
 *
 * The rename is guarded by NOT EXISTS so it can't collide with a location that
 * already holds the canonical name, which also makes it idempotent: re-running
 * once every row is canonical is a no-op.
 */
export class AlignSubSpecialitiesWithGatewayVocabulary1715001200000
  implements MigrationInterface
{
  name = 'AlignSubSpecialitiesWithGatewayVocabulary1715001200000';

  // [from, to] — canonical spelling on the right (matches GET /api/specialities).
  private static readonly RENAMES: ReadonlyArray<readonly [string, string]> = [
    ['EM - OP', 'EM -OP'],
    ['WHC Profee / facility', 'WHC Profee/ facility'],
  ];

  private static async rename(
    queryRunner: QueryRunner,
    from: string,
    to: string,
  ): Promise<void> {
    // Skip any location that already has the target name so the unique
    // (location_id, name) index can't trip.
    await queryRunner.query(
      `UPDATE "sub_specialities" s
       SET "name" = $2, "updated_at" = now()
       WHERE s."name" = $1
         AND NOT EXISTS (
           SELECT 1 FROM "sub_specialities" t
           WHERE t."location_id" = s."location_id" AND t."name" = $2
         )`,
      [from, to],
    );
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [from, to] of AlignSubSpecialitiesWithGatewayVocabulary1715001200000.RENAMES) {
      await AlignSubSpecialitiesWithGatewayVocabulary1715001200000.rename(queryRunner, from, to);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse the rename. Pairs with 1715001000000.down() (which DELETEs the
    // old-spelling names) if both are rolled back, in reverse order.
    for (const [from, to] of AlignSubSpecialitiesWithGatewayVocabulary1715001200000.RENAMES) {
      await AlignSubSpecialitiesWithGatewayVocabulary1715001200000.rename(queryRunner, to, from);
    }
  }
}

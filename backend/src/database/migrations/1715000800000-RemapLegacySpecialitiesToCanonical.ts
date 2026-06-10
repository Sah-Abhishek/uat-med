import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Align worklist primary specialities with the names the AI gateway actually
 * recognizes (GET /api/specialities). Matching on the gateway is exact-ish, so
 * legacy names like "ED" / "IP DRG" / "E/M" silently fell through to the default
 * (no speciality RAG). This repoints each affected worklist to the canonical,
 * AI-registered row OF ITS OWN CLIENT (primary specialities are client-scoped).
 *
 *   ED            -> ED Facility
 *   IP DRG        -> IP-DRG
 *   E/M           -> EM
 *   Denial/Edits  -> Denial/ Edits   (catalogue dup; note the literal space)
 *
 * "Inpatient" is intentionally LEFT AS-IS — it has no AI equivalent and, per
 * product decision, stays its own speciality (those encounters run on default).
 *
 * The legacy catalogue rows are intentionally KEPT ACTIVE (product decision) —
 * only the worklist pointers are corrected. This migration does NOT deactivate
 * anything.
 *
 * Idempotent: re-running is a no-op once worklists already point at canonical rows.
 */
export class RemapLegacySpecialitiesToCanonical1715000800000 implements MigrationInterface {
  name = 'RemapLegacySpecialitiesToCanonical1715000800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Repoint worklists: legacy row -> canonical row in the SAME client. The
    // legacy rows themselves are left active and selectable, by design.
    await queryRunner.query(`
      UPDATE "worklists" w
      SET "primary_speciality_id" = canon."id"
      FROM "primary_specialities" legacy
      JOIN "primary_specialities" canon ON canon."client_id" = legacy."client_id"
      WHERE w."primary_speciality_id" = legacy."id"
        AND (legacy."name", canon."name") IN (
          ('ED', 'ED Facility'),
          ('IP DRG', 'IP-DRG'),
          ('E/M', 'EM'),
          ('Denial/Edits', 'Denial/ Edits')
        )
    `);
  }

  public async down(): Promise<void> {
    // The worklist repoint is a data correction and is NOT reverted — once
    // merged into the canonical row, the original (ED vs IP DRG vs E/M) split
    // can't be reconstructed by name. No-op.
  }
}

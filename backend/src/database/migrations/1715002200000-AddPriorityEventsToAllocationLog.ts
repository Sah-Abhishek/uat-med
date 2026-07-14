import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Extends `chart_allocation_events` so the same audit log also records
 * priority-PIN changes (not just coder/auditor allocations): `event_type`
 * ('ALLOCATION' | 'PRIORITY'), and `from_priority` → `to_priority` for pin
 * events. `role` becomes nullable (priority events carry no role). SCHEMA-ONLY,
 * additive; existing rows default to event_type='ALLOCATION'. Idempotent.
 */
export class AddPriorityEventsToAllocationLog1715002200000 implements MigrationInterface {
  name = 'AddPriorityEventsToAllocationLog1715002200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE chart_allocation_events ADD COLUMN IF NOT EXISTS event_type VARCHAR(16) NOT NULL DEFAULT 'ALLOCATION';`);
    await queryRunner.query(`ALTER TABLE chart_allocation_events ADD COLUMN IF NOT EXISTS from_priority VARCHAR(16);`);
    await queryRunner.query(`ALTER TABLE chart_allocation_events ADD COLUMN IF NOT EXISTS to_priority VARCHAR(16);`);
    await queryRunner.query(`ALTER TABLE chart_allocation_events ALTER COLUMN role DROP NOT NULL;`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_cae_event_type ON chart_allocation_events (event_type);`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_cae_event_type;`);
    await queryRunner.query(`ALTER TABLE chart_allocation_events DROP COLUMN IF EXISTS event_type;`);
    await queryRunner.query(`ALTER TABLE chart_allocation_events DROP COLUMN IF EXISTS from_priority;`);
    await queryRunner.query(`ALTER TABLE chart_allocation_events DROP COLUMN IF EXISTS to_priority;`);
    // role left nullable (harmless; re-adding NOT NULL could fail if PRIORITY rows exist).
  }
}

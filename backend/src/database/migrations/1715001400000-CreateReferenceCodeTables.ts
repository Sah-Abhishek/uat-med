import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Read-only reference tables for the Chart Info code autocompletes:
 *   - pcs_codes : ICD-10-PCS procedure codes (~57k rows)
 *   - drg_codes : MS-DRG codes (~1k rows)
 * Both are seeded from the docs spreadsheets by scripts/seed-reference-codes.ts.
 * Indexed on `code` for the prefix (ILIKE 'q%') typeahead search.
 */
export class CreateReferenceCodeTables1715001400000 implements MigrationInterface {
  name = 'CreateReferenceCodeTables1715001400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['pcs_codes', 'drg_codes']) {
      await queryRunner.createTable(
        new Table({
          name: table,
          columns: [
            { name: 'id', type: 'bigint', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
            { name: 'code', type: 'varchar', length: '16' },
            { name: 'description', type: 'text' },
          ],
        }),
        true,
      );
      await queryRunner.createIndex(
        table,
        new TableIndex({ name: `IDX_${table}_code`, columnNames: ['code'] }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('drg_codes', true);
    await queryRunner.dropTable('pcs_codes', true);
  }
}

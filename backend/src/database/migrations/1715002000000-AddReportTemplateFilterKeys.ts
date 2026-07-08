import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds `report_templates.filter_keys` — the set of filter controls a template
 * exposes in the Reports Filters section (a JSON array of filterable field
 * keys). Separate from the existing `filters` column (saved values); templates
 * now persist which filters to show so loading one narrows the Filters section
 * to just those controls.
 *
 * SCHEMA-ONLY, non-null with a `'[]'` default so existing templates keep
 * working (they simply expose no template-specific filter set until re-saved).
 * Idempotent (dev runs with synchronize:true may add the column first).
 */
export class AddReportTemplateFilterKeys1715002000000 implements MigrationInterface {
  name = 'AddReportTemplateFilterKeys1715002000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('report_templates', 'filter_keys'))) {
      await queryRunner.addColumn(
        'report_templates',
        new TableColumn({ name: 'filter_keys', type: 'jsonb', isNullable: false, default: "'[]'" }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('report_templates', 'filter_keys')) {
      await queryRunner.dropColumn('report_templates', 'filter_keys');
    }
  }
}

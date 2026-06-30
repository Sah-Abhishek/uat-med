import 'reflect-metadata';
import * as path from 'path';
import * as ExcelJS from 'exceljs';
import { AppDataSource } from '../src/database/data-source';

/**
 * One-time seed of the PCS / DRG reference tables from the docs spreadsheets.
 *
 *   NODE_ENV=production npx ts-node scripts/seed-reference-codes.ts
 *
 * Idempotent: each table is TRUNCATEd then bulk-reloaded, so re-running refreshes
 * the data. Requires the tables to exist (run the migration first).
 */
const DOCS = path.resolve(__dirname, '..', '..', 'docs');

const SOURCES = [
  { table: 'drg_codes', file: 'MS DRG list-2027.xlsx' },
  { table: 'pcs_codes', file: 'PCS_Master_Converted.xlsx' },
];

async function loadSheet(file: string): Promise<Array<{ code: string; description: string }>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(DOCS, file));
  const ws = wb.worksheets[0];
  const out: Array<{ code: string; description: string }> = [];
  ws.eachRow((row, idx) => {
    if (idx === 1) return; // header row (Code/DRG, Description)
    const code = String(row.getCell(1).value ?? '').trim();
    const description = String(row.getCell(2).value ?? '').trim();
    if (code) out.push({ code, description });
  });
  return out;
}

async function seedTable(table: string, rows: Array<{ code: string; description: string }>): Promise<void> {
  await AppDataSource.query(`TRUNCATE TABLE ${table} RESTART IDENTITY`);
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const placeholders: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((r, j) => {
      placeholders.push(`($${j * 2 + 1}, $${j * 2 + 2})`);
      params.push(r.code, r.description);
    });
    await AppDataSource.query(
      `INSERT INTO ${table} (code, description) VALUES ${placeholders.join(',')}`,
      params,
    );
  }
  console.log(`Seeded ${rows.length} rows into ${table}`);
}

(async () => {
  await AppDataSource.initialize();
  try {
    for (const { table, file } of SOURCES) {
      const rows = await loadSheet(file);
      await seedTable(table, rows);
    }
    console.log('Reference-code seed complete.');
  } finally {
    await AppDataSource.destroy();
  }
})().catch((e) => {
  console.error('Reference-code seed failed:', e);
  process.exit(1);
});

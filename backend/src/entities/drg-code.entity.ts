import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Reference list of MS-DRG codes, seeded from the MS DRG spreadsheet (~1k rows).
 * Read-only lookup that powers the Chart Info "DRG Value" autocomplete (prefix
 * search on `code`).
 */
@Entity('drg_codes')
export class DrgCode {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;

  @Column({ type: 'varchar', length: 16 }) @Index() code: string;

  @Column({ type: 'text' }) description: string;
}

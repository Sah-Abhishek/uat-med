import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Reference list of ICD-10-PCS procedure codes, seeded from the PCS master
 * spreadsheet (~57k rows). Read-only lookup that powers the Chart Info
 * "PCS codes" autocomplete (prefix search on `code`).
 */
@Entity('pcs_codes')
export class PcsCode {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;

  @Column({ type: 'varchar', length: 16 }) @Index() code: string;

  @Column({ type: 'text' }) description: string;
}

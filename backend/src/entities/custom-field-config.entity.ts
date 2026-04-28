import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Admin-defined chart field, scoped to (location, speciality?).
 * `specialityId = null` is the "All specialities" baseline; non-null rows are deltas.
 */
@Entity('custom_field_configs')
@Index(['locationId', 'specialityId', 'name'], { unique: true })
export class CustomFieldConfig {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;

  @Index()
  @Column({ name: 'location_id', type: 'bigint' }) locationId: number;

  @Index()
  @Column({ name: 'speciality_id', type: 'bigint', nullable: true }) specialityId: number | null;

  @Column({ type: 'varchar', length: 160 }) name: string;

  /** 'text' | 'dropdown' | 'date' | 'number' | 'multiline' | 'checkbox' */
  @Column({ type: 'varchar', length: 32 }) type: string;

  @Column({ name: 'is_multi_select', type: 'boolean', default: false }) isMultiSelect: boolean;

  /** 'MANDATORY' | 'NON_MANDATORY' | 'NOT_APPLICABLE' */
  @Column({ type: 'varchar', length: 32 }) validation: string;

  /** 'Chart Info' | 'Processing Info' */
  @Column({ type: 'varchar', length: 64, default: 'Chart Info' }) placement: string;

  @Column({ type: 'jsonb', nullable: true }) options?: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Per-(location, speciality?) override of a system-defined chart field's requirement.
 * `specialityId = null` is the "All specialities" baseline; non-null rows are deltas.
 */
@Entity('standard_field_configs')
@Index(['locationId', 'specialityId', 'fieldKey'], { unique: true })
export class StandardFieldConfig {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;

  @Index()
  @Column({ name: 'location_id', type: 'bigint' }) locationId: number;

  @Index()
  @Column({ name: 'speciality_id', type: 'bigint', nullable: true }) specialityId: number | null;

  @Column({ name: 'field_key', type: 'varchar', length: 64 }) fieldKey: string;

  /** 'MANDATORY' | 'NON_MANDATORY' | 'NOT_APPLICABLE' */
  @Column({ type: 'varchar', length: 32 }) requirement: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

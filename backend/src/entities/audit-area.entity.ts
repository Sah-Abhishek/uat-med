import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('audit_areas')
@Index(['locationId', 'name'], { unique: true })
export class AuditArea {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;

  @Index()
  @Column({ name: 'location_id', type: 'bigint' }) locationId: number;

  @Column({ type: 'varchar', length: 160 }) name: string;

  /** True for the seven seeded areas; cannot be deleted by the user. */
  @Column({ name: 'is_builtin', type: 'boolean', default: false }) isBuiltin: boolean;

  /** True for system-managed areas the user cannot rename or delete. */
  @Column({ name: 'is_system', type: 'boolean', default: false }) isSystem: boolean;

  /** Whether this area renders as a row in the chart Audit Information table.
   * Lets a Team Lead deactivate an area — including built-ins, which can't be
   * deleted — without losing its configured reasons. */
  @Column({ name: 'is_active', type: 'boolean', default: true }) isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

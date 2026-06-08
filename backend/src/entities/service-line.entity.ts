import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Service Line — a global lookup picked at document-upload time and stored per
 * chart (charts.service_line_id). Deliberately NOT scoped to a client/location:
 * the catalogue is shared across tenants (ED Facility, ED Profee, IP-DRG, …).
 *
 * New service lines are just new rows — no code change required. `sortOrder`
 * preserves the business-defined ordering in every picker (the list is NOT
 * alphabetical); `isActive=false` soft-hides a line everywhere without deleting
 * it, so charts that already reference it stay valid.
 */
@Entity('service_lines')
export class ServiceLine {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;

  @Column({ type: 'varchar', length: 120, unique: true }) name: string;

  // Optional short code (UNIQUE). Empty/absent → NULL so multiple code-less
  // rows don't collide on the unique index (Postgres permits many NULLs).
  @Column({ type: 'varchar', length: 32, nullable: true, unique: true }) code?: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 }) @Index() sortOrder: number;

  @Column({ name: 'is_active', type: 'boolean', default: true }) isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

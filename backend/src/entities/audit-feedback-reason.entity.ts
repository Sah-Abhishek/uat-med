import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('audit_feedback_reasons')
@Index(['auditAreaId', 'name'], { unique: true })
export class AuditFeedbackReason {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;

  @Index()
  @Column({ name: 'audit_area_id', type: 'bigint' }) auditAreaId: number;

  /** Denormalized for fast per-location lookups. */
  @Index()
  @Column({ name: 'location_id', type: 'bigint' }) locationId: number;

  @Column({ type: 'varchar', length: 200 }) name: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

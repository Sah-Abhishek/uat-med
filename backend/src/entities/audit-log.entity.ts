import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('audit_log')
export class AuditLog {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;

  @Column({ name: 'user_id', type: 'bigint', nullable: true }) userId?: number;

  @Column({ type: 'varchar', length: 80 }) @Index() action: string;
  @Column({ name: 'resource_type', type: 'varchar', length: 60 }) resourceType: string;
  @Column({ name: 'resource_id', type: 'varchar', length: 64, nullable: true }) resourceId?: string;

  @Column({ type: 'varchar', length: 45, nullable: true }) ip?: string;
  @Column({ name: 'user_agent', type: 'varchar', length: 500, nullable: true }) userAgent?: string;

  @Column({ type: 'jsonb', nullable: true }) payload?: Record<string, any>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) @Index() createdAt: Date;
}

import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { User } from './user.entity';

@Entity('report_templates')
@Unique(['ownerId', 'name'])
export class ReportTemplate {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;

  @Column({ name: 'owner_id', type: 'bigint' }) @Index() ownerId: number;
  @ManyToOne(() => User) @JoinColumn({ name: 'owner_id' }) owner: User;

  @Column({ type: 'varchar', length: 120 }) name: string;

  @Column({ type: 'jsonb' }) columns: string[];
  @Column({ type: 'jsonb' }) filters: Record<string, any>;
  @Column({ name: 'is_shared', type: 'boolean', default: false }) isShared: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

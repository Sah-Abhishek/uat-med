import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Chart } from './chart.entity';
import { User } from './user.entity';

@Entity('chart_allocations')
export class ChartAllocation {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;

  @Column({ name: 'chart_id', type: 'bigint' }) @Index() chartId: number;

  @ManyToOne(() => Chart, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chart_id' })
  chart: Chart;

  @Column({ name: 'user_id', type: 'bigint' }) @Index() userId: number;
  @ManyToOne(() => User) @JoinColumn({ name: 'user_id' }) user: User;

  @Column({ type: 'varchar', length: 16 }) role: 'CODER' | 'AUDITOR';

  @CreateDateColumn({ name: 'allocated_at', type: 'timestamptz' }) allocatedAt: Date;

  @Column({ name: 'allocated_by', type: 'bigint', nullable: true }) allocatedBy?: number;

  @Column({ name: 'released_at', type: 'timestamptz', nullable: true }) releasedAt?: Date;
}

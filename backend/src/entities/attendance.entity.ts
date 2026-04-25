import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { AttendanceStatus } from '../common/enums';
import { User } from './user.entity';

@Entity('attendance')
@Unique(['userId', 'date'])
export class Attendance {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;

  @Column({ name: 'user_id', type: 'bigint' }) @Index() userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'date' }) @Index() date: string;

  @Column({ type: 'varchar', length: 10 }) status: AttendanceStatus;

  @Column({ name: 'marked_by', type: 'bigint', nullable: true }) markedBy?: number;
  @Column({ name: 'marked_at', type: 'timestamptz', nullable: true }) markedAt?: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

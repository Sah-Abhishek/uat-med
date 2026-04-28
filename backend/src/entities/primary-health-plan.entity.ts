import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('primary_health_plans')
@Index(['locationId', 'name'], { unique: true })
export class PrimaryHealthPlan {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;

  @Index()
  @Column({ name: 'location_id', type: 'bigint' }) locationId: number;

  @Column({ type: 'varchar', length: 160 }) name: string;
  @Column({ name: 'is_active', type: 'boolean', default: true }) isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

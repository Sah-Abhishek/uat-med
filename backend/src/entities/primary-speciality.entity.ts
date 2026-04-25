import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('primary_specialities')
export class PrimarySpeciality {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;

  @Column({ name: 'client_id', type: 'bigint', nullable: true }) clientId?: number;
  @Column({ name: 'location_id', type: 'bigint', nullable: true }) locationId?: number;

  @Column({ type: 'varchar', length: 120 }) name: string;
  @Column({ name: 'is_active', type: 'boolean', default: true }) isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

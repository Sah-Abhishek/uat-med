import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { Client } from './client.entity';

@Entity('locations')
@Unique(['clientId', 'name'])
export class Location {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;

  @Column({ name: 'client_id', type: 'bigint' }) @Index() clientId: number;

  @ManyToOne(() => Client, c => c.locations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client: Client;

  @Column({ type: 'varchar', length: 160 }) name: string;
  @Column({ type: 'varchar', length: 32, nullable: true }) code?: string;
  @Column({ name: 'is_active', type: 'boolean', default: true }) isActive: boolean;

  @Column({ name: 'does_support_process_wise_coding', type: 'boolean', default: false })
  doesSupportProcessWiseCoding: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

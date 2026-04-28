import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { WorklistStatus } from '../common/enums';
import { Client } from './client.entity';
import { Location } from './location.entity';
import { PrimarySpeciality } from './primary-speciality.entity';
import { Process } from './process.entity';
import { Chart } from './chart.entity';

@Entity('worklists')
@Index(['clientId', 'locationId'])
export class Worklist {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;

  @Column({ name: 'worklist_number', type: 'varchar', length: 32, unique: true })
  @Index()
  worklistNumber: string;

  @Column({ name: 'client_id', type: 'bigint' }) @Index() clientId: number;
  @ManyToOne(() => Client) @JoinColumn({ name: 'client_id' }) client: Client;

  @Column({ name: 'location_id', type: 'bigint' }) @Index() locationId: number;
  @ManyToOne(() => Location) @JoinColumn({ name: 'location_id' }) location: Location;

  @Column({ name: 'primary_speciality_id', type: 'bigint' }) primarySpecialityId: number;
  @ManyToOne(() => PrimarySpeciality) @JoinColumn({ name: 'primary_speciality_id' })
  primarySpeciality: PrimarySpeciality;

  @Column({ name: 'process_id', type: 'bigint' }) processId: number;
  @ManyToOne(() => Process) @JoinColumn({ name: 'process_id' }) process: Process;

  @Column({ name: 'date_of_service', type: 'date', nullable: true }) dateOfService?: string;
  @Column({ name: 'received_date', type: 'date' }) @Index() receivedDate: string;

  @Column({ name: 'total_charts', type: 'int', default: 0 }) totalCharts: number;
  @Column({ name: 'net_change', type: 'int', default: 0 }) netChange: number;

  @Column({ type: 'varchar', length: 16, default: WorklistStatus.OPEN }) @Index()
  status: WorklistStatus;

  @Column({ name: 'created_by', type: 'bigint', nullable: true }) createdBy?: number;

  @OneToMany(() => Chart, c => c.worklist) charts: Chart[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' }) deletedAt?: Date;
}

import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Exclude } from 'class-transformer';
import { Role } from '../common/enums/roles.enum';
import { UserStatus } from '../common/enums';
import { Client } from './client.entity';
import { Location } from './location.entity';
import { PrimarySpeciality } from './primary-speciality.entity';

@Entity('users')
@Index(['email'], { unique: true })
@Index(['employeeId'], { unique: true, where: '"employee_id" IS NOT NULL' })
export class User {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'employee_id', type: 'varchar', length: 32, nullable: true })
  employeeId?: string;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ name: 'full_name', type: 'varchar', length: 255 })
  fullName: string;

  @Exclude()
  @Column({ name: 'password_hash', type: 'varchar', length: 255, nullable: true })
  passwordHash?: string;

  @Column({ type: 'varchar', length: 16 })
  @Index()
  role: Role;

  @Column({ type: 'varchar', length: 16, default: UserStatus.ACTIVE })
  @Index()
  status: UserStatus;

  @Column({ type: 'varchar', length: 120, nullable: true })
  designation?: string;

  @Column({ name: 'primary_speciality_id', type: 'bigint', nullable: true })
  primarySpecialityId?: number;

  @ManyToOne(() => PrimarySpeciality, { nullable: true }) @JoinColumn({ name: 'primary_speciality_id' })
  primarySpeciality?: PrimarySpeciality;

  @Column({ name: 'client_id', type: 'bigint', nullable: true })
  clientId?: number;
  @ManyToOne(() => Client, { nullable: true }) @JoinColumn({ name: 'client_id' })
  client?: Client;

  @Column({ name: 'location_id', type: 'bigint', nullable: true })
  locationId?: number;
  @ManyToOne(() => Location, { nullable: true }) @JoinColumn({ name: 'location_id' })
  location?: Location;

  @Column({ name: 'date_of_birth', type: 'date', nullable: true })
  dateOfBirth?: string;

  @Column({ name: 'date_of_joining', type: 'date', nullable: true })
  dateOfJoining?: string;

  @Column({ name: 'avatar_url', type: 'varchar', length: 512, nullable: true })
  avatarUrl?: string;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt?: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BootstrapService } from './bootstrap.service';
import { User } from '../entities/user.entity';
import { Chart } from '../entities/chart.entity';
import { Client } from '../entities/client.entity';
import { Location } from '../entities/location.entity';
import { AuthModule } from '../modules/auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([User, Chart, Client, Location]), AuthModule],
  providers: [BootstrapService],
})
export class BootstrapModule { }
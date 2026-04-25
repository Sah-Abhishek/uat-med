import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BootstrapService } from './bootstrap.service';
import { User } from '../entities/user.entity';
import { AuthModule } from '../modules/auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([User]), AuthModule],
  providers: [BootstrapService],
})
export class BootstrapModule { }
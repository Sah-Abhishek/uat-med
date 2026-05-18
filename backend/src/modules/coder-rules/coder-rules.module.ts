import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CoderRulesController } from './coder-rules.controller';
import { CoderRulesService } from './coder-rules.service';
import { User } from '../../entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [CoderRulesController],
  providers: [CoderRulesService],
})
export class CoderRulesModule {}

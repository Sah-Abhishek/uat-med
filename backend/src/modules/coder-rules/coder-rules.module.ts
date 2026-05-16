import { Module } from '@nestjs/common';
import { CoderRulesController } from './coder-rules.controller';

@Module({
  controllers: [CoderRulesController],
})
export class CoderRulesModule {}

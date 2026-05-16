import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AiGatewayClient } from './ai-gateway.service';
import { CoderRegistrationService } from './coder-registration.service';
import { User } from '../../entities/user.entity';

/**
 * Global so any module (charts, coder-rules, qa, auth, …) can inject
 * AiGatewayClient or CoderRegistrationService without re-importing this
 * module everywhere.
 *
 * The gateway is the only thing this app talks to upstream — what sits behind
 * it (orchestrator, RAG, Qdrant, Postgres) is the gateway's concern, not ours.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [AiGatewayClient, CoderRegistrationService],
  exports: [AiGatewayClient, CoderRegistrationService],
})
export class AiGatewayModule {}

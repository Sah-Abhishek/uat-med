import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AiGatewayClient, CoderRule, ListRulesQuery } from '../ai-gateway/ai-gateway.service';
import { CoderRegistrationService } from '../ai-gateway/coder-registration.service';
import { CreateRuleDto } from './dto/coder-rules.dto';
import { User } from '../../entities/user.entity';
import { UserStatus } from '../../common/enums';
import { AuthenticatedUser } from '../../common/types/request-user.type';

@Injectable()
export class CoderRulesService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly gateway: AiGatewayClient,
    private readonly registration: CoderRegistrationService,
  ) {}

  list(q: ListRulesQuery) {
    return this.gateway.listRules(q);
  }

  /**
   * The gateway's `created_by` is a UUID it issues from POST /admin/users
   * (stored as users.public_id), not our local bigint user id. Sending the
   * numeric local id makes the gateway 502 with "Gateway proxy error". So we
   * always resolve a fresh User row and ensure they have a publicId before
   * forwarding — auto-registering on the fly for admin roles that aren't
   * covered by the reviewer backfill.
   */
  async create(dto: CreateRuleDto, user: AuthenticatedUser): Promise<CoderRule> {
    const dbUser = await this.users.findOne({ where: { id: user.id } });
    if (!dbUser) {
      throw new ForbiddenException({
        error: { code: 'forbidden', message: 'Authoring user not found.' },
      });
    }
    if (dbUser.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException({
        error: { code: 'forbidden', message: 'Authoring user is not active.' },
      });
    }
    const createdBy = await this.registration.ensurePublicId(dbUser);
    return this.gateway.createRule({
      rule_text: dto.rule_text.trim(),
      applies_to: dto.applies_to,
      priority: dto.priority,
      created_by: createdBy,
    });
  }

  deactivate(id: string) {
    return this.gateway.deactivateRule(id);
  }
}

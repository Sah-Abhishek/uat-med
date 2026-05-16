import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AiGatewayClient } from '../ai-gateway/ai-gateway.service';
import { CreateRuleDto, ListRulesQueryDto } from './dto/coder-rules.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/roles.enum';
import { AuthenticatedUser } from '../../common/types/request-user.type';

@ApiTags('Coder Rules')
@ApiBearerAuth('bearerAuth')
@Controller('coder-rules')
@Roles(Role.TEAMLEAD, Role.MANAGER)
export class CoderRulesController {
  constructor(private readonly aiGateway: AiGatewayClient) {}

  @Get()
  @ApiOperation({ summary: 'List coder rules. Forwards to gateway GET /api/rules.' })
  list(@Query() q: ListRulesQueryDto) {
    return this.aiGateway.listRules(q);
  }

  @Post()
  // Override the class-level @Roles to also allow CODER and AUDITOR — they
  // can author rules from inside the Review & Edit modal. Listing and
  // deactivation stay TEAMLEAD/MANAGER (the class default).
  @Roles(Role.TEAMLEAD, Role.MANAGER, Role.CODER, Role.AUDITOR)
  @ApiOperation({ summary: 'Create a coder rule. Forwards to gateway POST /api/rules.' })
  create(@Body() dto: CreateRuleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.aiGateway.createRule({
      rule_text: dto.rule_text.trim(),
      applies_to: dto.applies_to,
      priority: dto.priority,
      // Gateway doesn't validate identity from the JWT (the JWT's `sub` is a
      // client_id, not a user UUID); per-user identity is body-level.
      created_by: String(user.id),
    });
  }

  @Patch(':id/deactivate')
  @ApiOperation({ summary: 'Soft-deactivate a rule. Forwards to gateway PATCH /api/rules/{id}/deactivate.' })
  deactivate(@Param('id') id: string) {
    return this.aiGateway.deactivateRule(id);
  }
}

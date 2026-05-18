import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CoderRulesService } from './coder-rules.service';
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
  constructor(private readonly service: CoderRulesService) {}

  @Get()
  @ApiOperation({ summary: 'List coder rules. Forwards to gateway GET /api/rules.' })
  list(@Query() q: ListRulesQueryDto) {
    return this.service.list(q);
  }

  @Post()
  // Override the class-level @Roles to also allow CODER and AUDITOR — they
  // can author rules from inside the Review & Edit modal. Listing and
  // deactivation stay TEAMLEAD/MANAGER (the class default).
  @Roles(Role.TEAMLEAD, Role.MANAGER, Role.CODER, Role.AUDITOR)
  @ApiOperation({ summary: 'Create a coder rule. Forwards to gateway POST /api/rules.' })
  create(@Body() dto: CreateRuleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id/deactivate')
  @ApiOperation({ summary: 'Soft-deactivate a rule. Forwards to gateway PATCH /api/rules/{id}/deactivate.' })
  deactivate(@Param('id') id: string) {
    return this.service.deactivate(id);
  }
}

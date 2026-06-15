import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AdminActiveWorkService } from './admin-active-work.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/roles.enum';

@ApiTags('Admin · Active work')
@ApiBearerAuth('bearerAuth')
@Controller('admin/active-work')
@Roles(Role.TEAMLEAD, Role.MANAGER)
export class AdminActiveWorkController {
  constructor(private readonly svc: AdminActiveWorkService) {}

  @Get()
  @ApiOperation({
    summary:
      'Charts being worked on right now — coders/auditors with a running timer, enriched with chart + worklist info.',
  })
  list() {
    return this.svc.listActiveWork();
  }
}

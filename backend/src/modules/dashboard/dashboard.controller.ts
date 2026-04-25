import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { DashboardService } from './dashboard.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/roles.enum';
import { AuthenticatedUser } from '../../common/types/request-user.type';

@ApiTags('Dashboard')
@ApiBearerAuth('bearerAuth')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly svc: DashboardService) {}

  @Get('milestones')
  @ApiOperation({ summary: 'Milestone counters (inProgress / readyToCode / readyToAllocate).' })
  milestones(@Query() q: { clientId?: number; locationId?: number }) { return this.svc.milestones(q); }

  @Get('status')
  @ApiOperation({ summary: 'Complete vs. incomplete chart counts.' })
  status(@Query() q: { clientId?: number; locationId?: number }) { return this.svc.status(q); }

  @Get('unallocated')
  @Roles(Role.MANAGER)
  @ApiOperation({ summary: 'Unallocated worklists and charts.' })
  unallocated(@Query() q: { clientId?: number; locationId?: number }) { return this.svc.unallocated(q); }

  @Get('allocation-stats')
  @Roles(Role.MANAGER)
  @ApiOperation({ summary: 'Allocation Statistics panel.' })
  allocationStats(@Query() q: any) { return this.svc.allocationStats(q); }

  @Get('self')
  @Roles(Role.CODER, Role.AUDITOR)
  @ApiOperation({ summary: 'Self view for coders / auditors.' })
  self(@CurrentUser() user: AuthenticatedUser) { return this.svc.self(user); }
}

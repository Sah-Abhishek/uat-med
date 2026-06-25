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
  @Roles(Role.MANAGER, Role.TEAMLEAD)
  @ApiOperation({ summary: 'Unallocated worklists and charts.' })
  unallocated(@Query() q: { clientId?: number; locationId?: number }) { return this.svc.unallocated(q); }

  @Get('allocation-stats')
  @Roles(Role.MANAGER, Role.TEAMLEAD)
  @ApiOperation({ summary: 'Allocation Statistics — milestone bar, completion / QC / worklist donuts, progress-to-date series.' })
  allocationStats(@Query() q: { clientId?: number; locationId?: number }) { return this.svc.allocationStats(q); }

  @Get('unallocated-volume')
  @Roles(Role.MANAGER, Role.TEAMLEAD)
  @ApiOperation({ summary: 'Unallocated Volume — by worklist / speciality / received-date / DOS.' })
  unallocatedVolume(@Query() q: { clientId?: number; locationId?: number }) { return this.svc.unallocatedVolume(q); }

  @Get('productivity')
  @Roles(Role.MANAGER, Role.TEAMLEAD)
  @ApiOperation({ summary: 'Productivity — daily volume, avg coding minutes, rework count.' })
  productivity(@Query() q: { clientId?: number; locationId?: number }) { return this.svc.productivity(q); }

  @Get('throughput')
  @Roles(Role.MANAGER, Role.TEAMLEAD)
  @ApiOperation({ summary: 'Charts allocated vs worked on — today counts + per-day series. Filter by client/location/speciality/facility.' })
  throughput(@Query() q: { clientId?: number; locationId?: number; specialityId?: number; facility?: string; userId?: number; days?: number; endsAt?: string }) {
    return this.svc.throughput(q);
  }

  @Get('ai-status')
  @Roles(Role.MANAGER, Role.TEAMLEAD)
  @ApiOperation({ summary: 'AI processing-status counts (processed / error / inProgress) across charts. Filter by client/location/speciality/facility.' })
  aiStatus(@Query() q: { clientId?: number; locationId?: number; specialityId?: number; facility?: string; userId?: number }) {
    return this.svc.aiProcessingStatus(q);
  }

  @Get('ai-status/series')
  @Roles(Role.MANAGER, Role.TEAMLEAD)
  @ApiOperation({ summary: 'AI processing-status per-day series (processed / error / inProgress). Filter by client/location/speciality/facility/days.' })
  aiStatusSeries(@Query() q: { clientId?: number; locationId?: number; specialityId?: number; facility?: string; userId?: number; days?: number; endsAt?: string }) {
    return this.svc.aiProcessingStatusSeries(q);
  }

  @Get('throughput/charts')
  @Roles(Role.MANAGER, Role.TEAMLEAD)
  @ApiOperation({ summary: 'Drill-down list of the charts behind the throughput metrics (kind=allocated|worked). Paginated.' })
  throughputCharts(@Query() q: { kind?: 'allocated' | 'worked'; clientId?: number; locationId?: number; specialityId?: number; facility?: string; userId?: number; days?: number; endsAt?: string; page?: number; pageSize?: number }) {
    return this.svc.throughputCharts(q);
  }

  @Get('throughput/by-client-location')
  @Roles(Role.MANAGER, Role.TEAMLEAD)
  @ApiOperation({ summary: 'Charts worked on grouped by client + location within the window — the busiest client/location pairs.' })
  throughputByClientLocation(@Query() q: { clientId?: number; locationId?: number; specialityId?: number; facility?: string; userId?: number; days?: number; endsAt?: string }) {
    return this.svc.throughputByClientLocation(q);
  }

  @Get('self')
  @Roles(Role.CODER, Role.AUDITOR)
  @ApiOperation({ summary: 'Self view for coders / auditors.' })
  self(@CurrentUser() user: AuthenticatedUser) { return this.svc.self(user); }
}

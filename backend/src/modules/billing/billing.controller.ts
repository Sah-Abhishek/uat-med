import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BillingService } from './billing.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/roles.enum';
import { AuthenticatedUser } from '../../common/types/request-user.type';

@ApiTags('Billing')
@ApiBearerAuth('bearerAuth')
@Controller('billing')
export class BillingController {
  constructor(private readonly svc: BillingService) {}

  @Get('settings')
  @Roles(Role.MANAGER, Role.TEAMLEAD)
  @ApiOperation({ summary: 'Get the global per-document billing rate.' })
  getSettings() {
    return this.svc.getSettings();
  }

  @Put('settings')
  @Roles(Role.TEAMLEAD, Role.MANAGER)
  @ApiOperation({ summary: 'Update the global per-document billing rate.' })
  updateSettings(
    @Body() body: { ratePerDocument: number; currency?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.svc.updateSettings(body, user.id);
  }

  @Get('summary')
  @Roles(Role.MANAGER, Role.TEAMLEAD)
  @ApiOperation({ summary: 'Billing totals + per-client / per-location / per-day breakdown.' })
  summary(
    @Query() q: { clientId?: number; locationId?: number; days?: number; endsAt?: string },
  ) {
    return this.svc.getSummary(q);
  }

  @Get('charts')
  @Roles(Role.MANAGER, Role.TEAMLEAD)
  @ApiOperation({ summary: 'Drill-down: charts with their document counts and billed amount.' })
  charts(
    @Query() q: { clientId?: number; locationId?: number; days?: number; endsAt?: string; page?: number; pageSize?: number },
  ) {
    return this.svc.listCharts(q);
  }
}

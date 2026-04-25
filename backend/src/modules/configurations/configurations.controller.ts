import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ConfigurationsService } from './configurations.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/roles.enum';

@ApiTags('Configurations')
@ApiBearerAuth('bearerAuth')
@Controller('configurations')
export class ConfigurationsController {
  constructor(private readonly svc: ConfigurationsService) {}

  // 17.1 General
  @Get('general')
  @Roles(Role.MANAGER)
  general() { return this.svc.general(); }

  @Put('general')
  @Roles(Role.ADMIN)
  updateGeneral(@Body() body: Record<string, any>) { return this.svc.updateGeneral(body); }

  // 17.2 Clients & locations
  @Get('clients') @Roles(Role.MANAGER) listClients() { return this.svc.listClients(); }
  @Post('clients') @Roles(Role.ADMIN) createClient(@Body() body: { name: string; code?: string; isActive?: boolean }) { return this.svc.createClient(body); }

  @Get('locations') @Roles(Role.MANAGER) listLocations(@Query('clientId', ParseIntPipe) clientId: number) { return this.svc.listLocations(clientId); }
  @Post('locations') @Roles(Role.ADMIN) createLocation(@Body() body: { clientId: number; name: string; code?: string; isActive?: boolean }) { return this.svc.createLocation(body); }

  // 17.3 Specialities → General
  @Get('specialities/general') @Roles(Role.MANAGER) specialitiesGeneral() { return this.svc.specialitiesGeneral(); }
  @Put('specialities/general') @Roles(Role.ADMIN) updateSpecialitiesGeneral(@Body() body: any) { return this.svc.updateSpecialitiesGeneral(body); }

  // 17.4 Specialities → Feedback Categories
  @Get('specialities/feedback-categories') @Roles(Role.MANAGER) feedbackCategories() { return this.svc.feedbackCategories(); }
  @Put('specialities/feedback-categories') @Roles(Role.ADMIN) updateFeedbackCategories(@Body() body: any) { return this.svc.updateFeedbackCategories(body); }
  @Post('specialities/feedback-categories/copy') @Roles(Role.ADMIN) copyFeedbackCategories(@Body() body: any) { return this.svc.copyFeedbackCategories(body); }

  // 17.5 Specialities → Auditing
  @Get('specialities/auditing') @Roles(Role.MANAGER) auditing() { return this.svc.auditing(); }
  @Put('specialities/auditing') @Roles(Role.ADMIN) updateAuditing(@Body() body: any) { return this.svc.updateAuditing(body); }

  // 17.6 Specialities → Coding
  @Get('specialities/coding') @Roles(Role.MANAGER) coding() { return this.svc.coding(); }
  @Put('specialities/coding') @Roles(Role.ADMIN) updateCoding(@Body() body: any) { return this.svc.updateCoding(body); }

  // 17.7 Specialities → Chart Field Configuration
  @Get('specialities/chart-fields') @Roles(Role.MANAGER) chartFields() { return this.svc.chartFields(); }
  @Put('specialities/chart-fields') @Roles(Role.ADMIN) updateChartFields(@Body() body: any) { return this.svc.updateChartFields(body); }
  @Post('specialities/chart-fields/custom') @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create a custom chart field.' })
  createCustomChartField(@Body() body: any) { return this.svc.createCustomChartField(body); }
  @Patch('specialities/chart-fields/custom/:id') @Roles(Role.ADMIN)
  updateCustomChartField(@Param('id', ParseIntPipe) id: number, @Body() body: any) { return this.svc.updateCustomChartField(id, body); }
  @Delete('specialities/chart-fields/custom/:id') @Roles(Role.ADMIN)
  deleteCustomChartField(@Param('id', ParseIntPipe) id: number) { return this.svc.deleteCustomChartField(id); }

  // 17.8 HCC tab
  @Get('hcc/fields') @Roles(Role.MANAGER) hccFields() { return this.svc.hccFields(); }
  @Post('hcc/fields') @Roles(Role.ADMIN) createHccField(@Body() body: any) { return this.svc.createHccField(body); }
  @Patch('hcc/fields/:id') @Roles(Role.ADMIN)
  updateHccField(@Param('id', ParseIntPipe) id: number, @Body() body: any) { return this.svc.updateHccField(id, body); }
  @Delete('hcc/fields/:id') @Roles(Role.ADMIN)
  deleteHccField(@Param('id', ParseIntPipe) id: number) { return this.svc.deleteHccField(id); }
}

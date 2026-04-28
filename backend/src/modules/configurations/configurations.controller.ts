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
  @Roles(Role.CODER, Role.AUDITOR, Role.MANAGER)
  general() { return this.svc.general(); }

  @Put('general')
  @Roles(Role.TEAMLEAD)
  updateGeneral(@Body() body: Record<string, any>) { return this.svc.updateGeneral(body); }

  // 17.2 Clients & locations
  @Get('clients') @Roles(Role.CODER, Role.AUDITOR, Role.MANAGER) listClients() { return this.svc.listClients(); }
  @Post('clients') @Roles(Role.TEAMLEAD) createClient(@Body() body: { name: string; code?: string; isActive?: boolean }) { return this.svc.createClient(body); }

  @Get('locations') @Roles(Role.CODER, Role.AUDITOR, Role.MANAGER) listLocations(@Query('clientId', ParseIntPipe) clientId: number) { return this.svc.listLocations(clientId); }
  @Post('locations') @Roles(Role.TEAMLEAD) createLocation(@Body() body: { clientId: number; name: string; code?: string; isActive?: boolean }) { return this.svc.createLocation(body); }

  @Get('primary-specialities')
  @Roles(Role.CODER, Role.AUDITOR, Role.MANAGER)
  listPrimarySpecialities(@Query() q: { clientId?: string }) {
    return this.svc.listPrimarySpecialities(q.clientId ? Number(q.clientId) : undefined);
  }

  @Get('processes')
  @Roles(Role.CODER, Role.AUDITOR, Role.MANAGER)
  listProcesses(@Query() q: { locationId?: string }) {
    if (!q.locationId) {
      return { items: [] };
    }
    return this.svc.listProcessesByLocation(Number(q.locationId));
  }

  // 17.3 Specialities → General
  @Get('specialities/general')
  @Roles(Role.CODER, Role.AUDITOR, Role.MANAGER)
  specialitiesGeneral(@Query() q: { clientId?: string; locationId?: string }) {
    return this.svc.specialitiesGeneral({
      clientId: q.clientId ? Number(q.clientId) : undefined,
      locationId: q.locationId ? Number(q.locationId) : undefined,
    });
  }

  @Put('specialities/general')
  @Roles(Role.TEAMLEAD)
  updateSpecialitiesGeneral(@Body() body: any) {
    return this.svc.updateSpecialitiesGeneral(body, {
      clientId: body?.clientId ? Number(body.clientId) : undefined,
      locationId: body?.locationId ? Number(body.locationId) : undefined,
    });
  }

  // 17.4 Specialities → Feedback Categories
  @Get('specialities/feedback-categories')
  @Roles(Role.CODER, Role.AUDITOR, Role.MANAGER)
  feedbackCategories(@Query() q: { clientId?: string; locationId?: string }) {
    return this.svc.feedbackCategories({
      clientId: q.clientId ? Number(q.clientId) : undefined,
      locationId: q.locationId ? Number(q.locationId) : undefined,
    });
  }

  @Put('specialities/feedback-categories')
  @Roles(Role.TEAMLEAD)
  updateFeedbackCategories(@Body() body: any) {
    return this.svc.updateFeedbackCategories(body, {
      clientId: body?.clientId ? Number(body.clientId) : undefined,
      locationId: body?.locationId ? Number(body.locationId) : undefined,
    });
  }

  @Post('specialities/feedback-categories/copy')
  @Roles(Role.TEAMLEAD)
  copyFeedbackCategories(@Body() body: any) {
    return this.svc.copyFeedbackCategories(body);
  }

  @Post('specialities/audit-areas')
  @Roles(Role.TEAMLEAD)
  createAuditArea(@Body() body: { clientId: number; locationId: number; name: string }) {
    return this.svc.createAuditArea(body);
  }

  @Delete('specialities/audit-areas/:id')
  @Roles(Role.TEAMLEAD)
  deleteAuditArea(@Param('id', ParseIntPipe) id: number, @Body() body: { clientId: number; locationId: number }) {
    return this.svc.deleteAuditArea(id, body);
  }

  // 17.5 Specialities → Auditing
  @Get('specialities/auditing')
  @Roles(Role.CODER, Role.AUDITOR, Role.MANAGER)
  auditing(@Query() q: { clientId?: string; locationId?: string }) {
    return this.svc.auditing({
      clientId: q.clientId ? Number(q.clientId) : undefined,
      locationId: q.locationId ? Number(q.locationId) : undefined,
    });
  }

  @Put('specialities/auditing')
  @Roles(Role.TEAMLEAD)
  updateAuditing(@Body() body: any) {
    return this.svc.updateAuditing(body, {
      clientId: body?.clientId ? Number(body.clientId) : undefined,
      locationId: body?.locationId ? Number(body.locationId) : undefined,
    });
  }

  // 17.6 Specialities → Coding
  @Get('specialities/coding')
  @Roles(Role.CODER, Role.AUDITOR, Role.MANAGER)
  coding(@Query() q: { clientId?: string; locationId?: string }) {
    return this.svc.coding({
      clientId: q.clientId ? Number(q.clientId) : undefined,
      locationId: q.locationId ? Number(q.locationId) : undefined,
    });
  }

  @Put('specialities/coding')
  @Roles(Role.TEAMLEAD)
  updateCoding(@Body() body: any) {
    return this.svc.updateCoding(body, {
      clientId: body?.clientId ? Number(body.clientId) : undefined,
      locationId: body?.locationId ? Number(body.locationId) : undefined,
    });
  }

  // 17.7 Specialities → Chart Field Configuration
  @Get('specialities/chart-fields')
  @Roles(Role.CODER, Role.AUDITOR, Role.MANAGER)
  chartFields(@Query() q: { clientId?: string; locationId?: string; specialityId?: string }) {
    return this.svc.chartFields({
      clientId: q.clientId ? Number(q.clientId) : undefined,
      locationId: q.locationId ? Number(q.locationId) : undefined,
      specialityId: q.specialityId ? Number(q.specialityId) : null,
    });
  }

  @Put('specialities/chart-fields')
  @Roles(Role.TEAMLEAD)
  updateChartFields(@Body() body: any) {
    return this.svc.updateChartFields(body, {
      clientId: body?.clientId ? Number(body.clientId) : undefined,
      locationId: body?.locationId ? Number(body.locationId) : undefined,
      specialityId: body?.specialityId ? Number(body.specialityId) : null,
    });
  }

  @Post('specialities/chart-fields/custom')
  @Roles(Role.TEAMLEAD)
  @ApiOperation({ summary: 'Create a custom chart field.' })
  createCustomChartField(@Body() body: any) { return this.svc.createCustomChartField(body); }

  @Patch('specialities/chart-fields/custom/:id')
  @Roles(Role.TEAMLEAD)
  updateCustomChartField(@Param('id', ParseIntPipe) id: number, @Body() body: any) { return this.svc.updateCustomChartField(id, body); }

  @Delete('specialities/chart-fields/custom/:id')
  @Roles(Role.TEAMLEAD)
  deleteCustomChartField(@Param('id', ParseIntPipe) id: number) { return this.svc.deleteCustomChartField(id); }

  // 17.8 HCC tab
  @Get('hcc/fields') @Roles(Role.CODER, Role.AUDITOR, Role.MANAGER) hccFields() { return this.svc.hccFields(); }
  @Post('hcc/fields') @Roles(Role.TEAMLEAD) createHccField(@Body() body: any) { return this.svc.createHccField(body); }
  @Patch('hcc/fields/:id') @Roles(Role.TEAMLEAD)
  updateHccField(@Param('id', ParseIntPipe) id: number, @Body() body: any) { return this.svc.updateHccField(id, body); }
  @Delete('hcc/fields/:id') @Roles(Role.TEAMLEAD)
  deleteHccField(@Param('id', ParseIntPipe) id: number) { return this.svc.deleteHccField(id); }
}

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
  @Get('clients') @Roles(Role.CODER, Role.AUDITOR, Role.MANAGER) listClients(@Query('includeInactive') includeInactive?: string) { return this.svc.listClients(includeInactive === 'true'); }
  @Post('clients') @Roles(Role.TEAMLEAD) createClient(@Body() body: { name: string; code?: string; isActive?: boolean; allowDuplicateChartNumbers?: boolean }) { return this.svc.createClient(body); }
  @Patch('clients/:id') @Roles(Role.TEAMLEAD) updateClient(@Param('id', ParseIntPipe) id: number, @Body() body: { name?: string; code?: string; isActive?: boolean; allowDuplicateChartNumbers?: boolean }) { return this.svc.updateClient(id, body); }
  @Delete('clients/:id') @Roles(Role.TEAMLEAD) deleteClient(@Param('id', ParseIntPipe) id: number) { return this.svc.deactivateClient(id); }
  @Delete('clients/:id/cascade') @Roles(Role.TEAMLEAD) cascadeDeleteClient(@Param('id', ParseIntPipe) id: number) { return this.svc.cascadeDeleteClient(id); }

  @Get('locations') @Roles(Role.CODER, Role.AUDITOR, Role.MANAGER) listLocations(@Query('clientId', ParseIntPipe) clientId: number, @Query('includeInactive') includeInactive?: string) { return this.svc.listLocations(clientId, includeInactive === 'true'); }
  @Post('locations') @Roles(Role.TEAMLEAD) createLocation(@Body() body: { clientId: number; name: string; code?: string; isActive?: boolean }) { return this.svc.createLocation(body); }
  @Patch('locations/:id') @Roles(Role.TEAMLEAD) updateLocation(@Param('id', ParseIntPipe) id: number, @Body() body: { name?: string; code?: string; isActive?: boolean }) { return this.svc.updateLocation(id, body); }
  @Delete('locations/:id') @Roles(Role.TEAMLEAD) deleteLocation(@Param('id', ParseIntPipe) id: number) { return this.svc.deactivateLocation(id); }
  @Delete('locations/:id/cascade') @Roles(Role.TEAMLEAD) cascadeDeleteLocation(@Param('id', ParseIntPipe) id: number) { return this.svc.cascadeDeleteLocation(id); }

  @Get('primary-specialities')
  @Roles(Role.CODER, Role.AUDITOR, Role.MANAGER)
  listPrimarySpecialities(@Query() q: { clientId?: string }) {
    return this.svc.listPrimarySpecialities(q.clientId ? Number(q.clientId) : undefined);
  }

  @Get('sub-specialities')
  @Roles(Role.CODER, Role.AUDITOR, Role.MANAGER)
  listSubSpecialities(@Query() q: { locationId?: string }) {
    if (!q.locationId) {
      return { items: [] };
    }
    return this.svc.listSubSpecialitiesByLocation(Number(q.locationId));
  }

  /** Every distinct sub-speciality NAME across all locations (deduped) — powers
   * the charts "all unique sub-specialities" filter, which matches by name. */
  @Get('sub-specialities/all')
  @Roles(Role.CODER, Role.AUDITOR, Role.MANAGER)
  listAllSubSpecialities() {
    return this.svc.listAllSubSpecialities();
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

  @Post('specialities/chart-fields/custom/copy')
  @Roles(Role.TEAMLEAD)
  @ApiOperation({ summary: 'Copy custom chart fields from another client/location scope.' })
  copyCustomChartFields(@Body() body: any) { return this.svc.copyCustomChartFields(body); }

  // 17.X Code Review Reasons (per client+location, codeType × action)
  @Get('code-review-reasons')
  @Roles(Role.CODER, Role.AUDITOR, Role.MANAGER)
  codeReviewReasons(@Query() q: { clientId?: string; locationId?: string }) {
    return this.svc.getCodeReviewReasons({
      clientId: q.clientId ? Number(q.clientId) : undefined,
      locationId: q.locationId ? Number(q.locationId) : undefined,
    });
  }

  @Put('code-review-reasons')
  @Roles(Role.TEAMLEAD)
  updateCodeReviewReasons(@Body() body: any) {
    return this.svc.updateCodeReviewReasons({
      clientId: body?.clientId ? Number(body.clientId) : undefined,
      locationId: body?.locationId ? Number(body.locationId) : undefined,
      codeType: body?.codeType,
      action: body?.action,
      reasons: body?.reasons,
    });
  }

  @Post('code-review-reasons/copy')
  @Roles(Role.TEAMLEAD)
  copyCodeReviewReasons(@Body() body: any) {
    return this.svc.copyCodeReviewReasons({
      sourceClientId: body?.sourceClientId ? Number(body.sourceClientId) : undefined,
      sourceLocationId: body?.sourceLocationId ? Number(body.sourceLocationId) : undefined,
      targetClientId: body?.targetClientId ? Number(body.targetClientId) : undefined,
      targetLocationId: body?.targetLocationId ? Number(body.targetLocationId) : undefined,
      codeTypes: Array.isArray(body?.codeTypes) ? body.codeTypes : undefined,
      actions: Array.isArray(body?.actions) ? body.actions : undefined,
      includeDisabled: body?.includeDisabled === true,
    });
  }

  // 17.X Service Lines (global lookup, picked at document upload)
  // Read is open to any working role (the upload dropdown needs it); mutations
  // are TEAMLEAD-only, matching clients/locations.
  @Get('service-lines')
  @Roles(Role.CODER, Role.AUDITOR, Role.MANAGER)
  listServiceLines(@Query('includeInactive') includeInactive?: string) {
    return this.svc.listServiceLines(includeInactive === 'true');
  }
  @Post('service-lines') @Roles(Role.TEAMLEAD)
  createServiceLine(@Body() body: { name: string; code?: string; sortOrder?: number; isActive?: boolean }) {
    return this.svc.createServiceLine(body);
  }
  @Patch('service-lines/:id') @Roles(Role.TEAMLEAD)
  updateServiceLine(@Param('id', ParseIntPipe) id: number, @Body() body: { name?: string; code?: string; sortOrder?: number; isActive?: boolean }) {
    return this.svc.updateServiceLine(id, body);
  }
  @Delete('service-lines/:id') @Roles(Role.TEAMLEAD)
  deleteServiceLine(@Param('id', ParseIntPipe) id: number) {
    return this.svc.deactivateServiceLine(id);
  }

  // 17.8 HCC tab
  @Get('hcc/fields') @Roles(Role.CODER, Role.AUDITOR, Role.MANAGER) hccFields() { return this.svc.hccFields(); }
  @Post('hcc/fields') @Roles(Role.TEAMLEAD) createHccField(@Body() body: any) { return this.svc.createHccField(body); }
  @Patch('hcc/fields/:id') @Roles(Role.TEAMLEAD)
  updateHccField(@Param('id', ParseIntPipe) id: number, @Body() body: any) { return this.svc.updateHccField(id, body); }
  @Delete('hcc/fields/:id') @Roles(Role.TEAMLEAD)
  deleteHccField(@Param('id', ParseIntPipe) id: number) { return this.svc.deleteHccField(id); }
}

import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ReportsService } from './reports.service';
import { QueryReportDto } from './dto/query-report.dto';
import { SaveTemplateDto } from './dto/save-template.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/request-user.type';

@ApiTags('Reports')
@ApiBearerAuth('bearerAuth')
@Controller('reports')
export class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  @Get('fields')
  @ApiOperation({ summary: 'Catalog of available report fields for the Customize dialog.' })
  fields() { return this.svc.fields(); }

  @Post('query')
  @HttpCode(200)
  @ApiOperation({ summary: 'Run a report query and return paginated tabular data.' })
  runQuery(@Body() dto: QueryReportDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.runQuery(dto, user);
  }

  @Get('templates')
  @ApiOperation({ summary: 'Saved templates visible to the caller (own + shared).' })
  listTemplates(@Query('page') page = 1, @Query('pageSize') pageSize = 20, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.listTemplates(Number(page), Number(pageSize), user);
  }

  @Post('templates')
  @HttpCode(201)
  @ApiOperation({ summary: 'Save a new report template.' })
  createTemplate(@Body() dto: SaveTemplateDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.createTemplate(dto, user.id);
  }

  @Get('templates/:id')
  getTemplate(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.getTemplate(id, user);
  }

  @Put('templates/:id')
  @ApiOperation({ summary: 'Replace a template definition.' })
  updateTemplate(@Param('id', ParseIntPipe) id: number, @Body() dto: SaveTemplateDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.updateTemplate(id, dto, user);
  }

  @Delete('templates/:id')
  deleteTemplate(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.deleteTemplate(id, user);
  }

  @Post('export')
  @HttpCode(202)
  @ApiOperation({ summary: 'Kick off an export (returns a taskId for async polling).' })
  export(@Body() dto: QueryReportDto & { format?: 'xlsx' | 'csv' }) {
    return this.svc.startExport(dto);
  }

  @Get('export/:taskId')
  @ApiOperation({ summary: 'Poll export status; returns a signed download URL when done.' })
  exportStatus(@Param('taskId') taskId: string) { return this.svc.exportStatus(taskId); }
}

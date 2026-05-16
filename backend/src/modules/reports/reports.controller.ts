import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { ReportsService } from './reports.service';
import { QueryReportDto } from './dto/query-report.dto';
import { SaveTemplateDto } from './dto/save-template.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/request-user.type';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/roles.enum';

@ApiTags('Reports')
@ApiBearerAuth('bearerAuth')
@Roles(Role.TEAMLEAD, Role.MANAGER)
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
  listTemplates(
    @Query('page') page = 1,
    @Query('pageSize') pageSize = 50,
    @CurrentUser() user: AuthenticatedUser,
  ) {
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

  /**
   * Synchronous Excel download. Same shape as the query endpoint — applies
   * filters, ignores pagination, caps at 50k rows. Returned as a
   * StreamableFile with `passthrough: true` so the global RequestIdInterceptor
   * can still stamp its X-Response-Time-Ms header before the response goes
   * out (using @Res() directly closes the response too early and crashes the
   * interceptor with ERR_HTTP_HEADERS_SENT).
   */
  @Post('export.xlsx')
  @HttpCode(200)
  @ApiOperation({ summary: 'Download the report as an .xlsx file.' })
  async exportXlsx(
    @Body() dto: QueryReportDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const buffer = await this.svc.exportToExcel(dto, user);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="valerion-report-${stamp}.xlsx"`);
    res.setHeader('Content-Length', buffer.length.toString());
    return new StreamableFile(buffer);
  }
}

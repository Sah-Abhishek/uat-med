import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ChartsService } from './charts.service';
import { QueryChartsDto } from './dto/query-charts.dto';
import { UpdateChartDto } from './dto/update-chart.dto';
import { BulkModifyDto, BulkIdsDto } from './dto/bulk-modify.dto';
import { ChartFeedbackDto, UpdateFeedbackDto } from './dto/chart-feedback.dto';
import { ProcessDocumentsDto } from './dto/process-documents.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/roles.enum';
import { AuthenticatedUser } from '../../common/types/request-user.type';

const MAX_FILE_BYTES = 50 * 1024 * 1024; // ICD gateway upload ceiling
const MAX_FILES = 20;

@ApiTags('Charts')
@ApiBearerAuth('bearerAuth')
@Controller('charts')
export class ChartsController {
  constructor(private readonly svc: ChartsService) {}

  @Get()
  @ApiOperation({ summary: 'Filterable, sortable chart grid (scoped by caller role).' })
  list(@Query() q: QueryChartsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.list(q, user);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Counters for priority tabs and top status cards.' })
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.summary(user);
  }

  @Get('active-timer')
  @Roles(Role.CODER, Role.AUDITOR)
  @ApiOperation({ summary: "Returns the user's currently running chart timer (or null)." })
  activeTimer(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.activeTimer(user);
  }

  @Get('columns')
  @ApiOperation({ summary: 'Current user\'s saved Columns Visibility configuration.' })
  columns(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.getColumns(user.id);
  }

  @Put('columns')
  @ApiOperation({ summary: 'Persist the user\'s Columns Visibility configuration.' })
  saveColumns(@CurrentUser() user: AuthenticatedUser, @Body() body: { columns: Array<{ key: string; visible: boolean }> }) {
    return this.svc.saveColumns(user.id, body.columns);
  }

  @Post('bulk/modify')
  @Roles(Role.MANAGER)
  @ApiOperation({ summary: 'Modify Charts popover — change priority and/or allocation for many charts.' })
  bulkModify(@Body() dto: BulkModifyDto) {
    return this.svc.bulkModify(dto);
  }

  @Post('bulk/self-allocate')
  @Roles(Role.CODER, Role.AUDITOR)
  @ApiOperation({ summary: 'Self Allocation — coder / auditor pulls charts to themselves.' })
  selfAllocate(@Body() dto: BulkIdsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.selfAllocate(dto.chartIds, user);
  }

  @Delete('bulk')
  @Roles(Role.MANAGER)
  @ApiOperation({ summary: 'Bulk soft-delete charts.' })
  bulkDelete(@Body() dto: BulkIdsDto) {
    return this.svc.bulkDelete(dto.chartIds);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Full chart detail for the coding editor.' })
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.svc.detail(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Persist coder / auditor edits (auto-save).' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateChartDto) {
    return this.svc.update(id, dto);
  }

  @Post(':id/start')
  @Roles(Role.CODER, Role.AUDITOR)
  @HttpCode(200)
  @ApiOperation({ summary: 'Start the coding / audit timer.' })
  start(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.startTimer(id, user);
  }

  @Post(':id/stop')
  @Roles(Role.CODER, Role.AUDITOR)
  @HttpCode(200)
  @ApiOperation({ summary: 'Stop the active timer; returns elapsed milliseconds.' })
  stop(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.stopTimer(id, user);
  }

  @Post(':id/transition')
  @Roles(Role.CODER, Role.AUDITOR)
  @HttpCode(200)
  @ApiOperation({ summary: 'Transition milestone / chartStatus. Validates allowed transitions.' })
  transition(@Param('id', ParseIntPipe) id: number, @Body() body: { milestone: string; chartStatus?: string }) {
    return this.svc.transition(id, body);
  }

  @Get(':id/feedback')
  @ApiOperation({ summary: 'Audit feedback rows for a chart.' })
  listFeedback(@Param('id', ParseIntPipe) id: number) {
    return this.svc.listFeedback(id);
  }

  @Post(':id/feedback')
  @Roles(Role.AUDITOR)
  @HttpCode(201)
  @ApiOperation({ summary: 'Auditor adds feedback.' })
  addFeedback(@Param('id', ParseIntPipe) id: number, @Body() dto: ChartFeedbackDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.addFeedback(id, dto, user.id);
  }

  @Patch('feedback/:feedbackId')
  @Roles(Role.CODER)
  @ApiOperation({ summary: 'Coder responds to feedback (Agree / Reject / Implement).' })
  updateFeedback(@Param('feedbackId', ParseIntPipe) feedbackId: number, @Body() dto: UpdateFeedbackDto) {
    return this.svc.updateFeedback(feedbackId, dto);
  }

  /**
   * Run the ICD Predictor encounter flow for an uploaded batch of documents.
   * The frontend POSTs multipart/form-data with N `files` plus a comma-
   * separated `reportTypes` (HP, DISCHARGE_SUMMARY, …) in the SAME order.
   *
   * The request blocks until the gateway pipeline finishes (typically 30–90s,
   * polled at ICD_PREDICTOR_POLL_INTERVAL up to ICD_PREDICTOR_POLL_TIMEOUT).
   */
  @Post(':id/process-documents')
  @Roles(Role.CODER, Role.AUDITOR)
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES, {
      limits: { fileSize: MAX_FILE_BYTES },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
        reportTypes: { type: 'string', description: 'Comma-separated list, one per file in order.' },
        documentType: { type: 'string', description: 'Optional fallback hint when reportTypes is missing.' },
      },
    },
  })
  @ApiOperation({ summary: 'Upload documents and run ICD Predictor (encounter flow).' })
  processDocuments(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: ProcessDocumentsDto,
  ) {
    if (!files?.length) {
      throw new BadRequestException({ error: { code: 'bad_request', message: 'No files uploaded.' } });
    }
    return this.svc.processDocuments(id, files, body);
  }
}

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
  Query,
  Res,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { WorklistsService } from './worklists.service';
import { WorklistBulkService } from './bulk.service';
import { CreateWorklistDto } from './dto/create-worklist.dto';
import { AddChartsDto } from './dto/add-charts.dto';
import { UpdateWorklistDto } from './dto/update-worklist.dto';
import { QueryWorklistsDto } from './dto/query-worklists.dto';
import { AllocateWorklistDto } from './dto/allocate-worklist.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/roles.enum';
import { AuthenticatedUser } from '../../common/types/request-user.type';

const BULK_MAX_FILE_BYTES = 50 * 1024 * 1024;
const BULK_MAX_FILES = 200;

@ApiTags('Worklists')
@ApiBearerAuth('bearerAuth')
@Controller('worklists')
export class WorklistsController {
  constructor(
    private readonly svc: WorklistsService,
    private readonly bulk: WorklistBulkService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Paginated, filtered, sortable worklist list.' })
  list(@Query() q: QueryWorklistsDto) {
    return this.svc.list(q);
  }

  @Get('status-summary')
  @ApiOperation({ summary: 'Counters for the three status cards (OPEN / IN_PROGRESS / CLOSED).' })
  statusSummary(@Query() q: { clientId?: number; locationId?: number }) {
    return this.svc.statusSummary(q);
  }

  /* ── Bulk: Excel template (static, non-:id route — declared before /:id) ── */
  @Get('bulk-template')
  @Roles(Role.MANAGER, Role.TEAMLEAD)
  @ApiOperation({ summary: 'Download the bulk-import Excel template (A/C, MRN, DOS, ADM, DSC).' })
  async bulkTemplate(@Res() res: Response) {
    const buf = await this.bulk.buildTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="charts-bulk-template.xlsx"');
    res.send(buf);
  }

  @Post()
  @HttpCode(201)
  @Roles(Role.MANAGER)
  @ApiOperation({ summary: 'Add Volume — create a worklist.' })
  create(@Body() dto: CreateWorklistDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.create(dto, user.id);
  }

  /* ── Add Volume from Excel — create worklist + import charts in one call ── */
  @Post('from-excel')
  @HttpCode(201)
  @Roles(Role.MANAGER, Role.TEAMLEAD)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: BULK_MAX_FILE_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        worklistNumber: { type: 'string' },
        clientId: { type: 'integer' },
        locationId: { type: 'integer' },
        primarySpecialityId: { type: 'integer' },
        subSpecialityId: { type: 'integer' },
        processId: { type: 'integer' },
        receivedDate: { type: 'string', format: 'date' },
        dateOfService: { type: 'string', format: 'date' },
        dateOfServiceTo: { type: 'string', format: 'date' },
      },
    },
  })
  @ApiOperation({ summary: 'Create a worklist atomically from an uploaded Excel file.' })
  createFromExcel(
    @Body() dto: CreateWorklistDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bulk.createFromExcel(dto, file, user.id);
  }

  /* ── Bulk: retry the AI pipeline for every errored chart (global) ──
   * Static route declared before /:id so the param route doesn't swallow it.
   * Lives under /worklists because the serial AI-dispatch queue is implemented
   * in WorklistBulkService; the action itself is system-wide. */
  @Post('retry-ai-errored')
  @Roles(Role.MANAGER, Role.TEAMLEAD)
  @ApiOperation({
    summary: 'Re-queue the AI pipeline for every AI-errored chart system-wide (skips orphaned / soft-deleted charts).',
  })
  retryAiErrored() {
    return this.bulk.retryAllErroredCharts();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Full detail for the worklist detail page.' })
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.svc.detail(id);
  }

  @Patch(':id')
  @Roles(Role.MANAGER)
  @ApiOperation({ summary: 'Edit worklist metadata.' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateWorklistDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.MANAGER)
  @ApiOperation({ summary: 'Hard-delete with worklistNumber confirmation echo.' })
  remove(@Param('id', ParseIntPipe) id: number, @Body('worklistNumber') worklistNumber: string) {
    return this.svc.remove(id, worklistNumber);
  }

  @Post(':id/allocate')
  @Roles(Role.MANAGER)
  @ApiOperation({ summary: 'Allocate fresh volume (serial ranges → assignees).' })
  allocate(@Param('id', ParseIntPipe) id: number, @Body() dto: AllocateWorklistDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.allocate(id, dto, user.id);
  }

  @Post(':id/reallocate')
  @Roles(Role.MANAGER)
  @ApiOperation({ summary: 'Reallocate a range to a different user (full or partial).' })
  reallocate(@Param('id', ParseIntPipe) id: number, @Body() body: { from: number; to: number; assigneeId: number; role: 'CODER' | 'AUDITOR' }, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.reallocate(id, body, user.id);
  }

  /* ── Manually add charts (Manage Charts → Add charts) ── */
  @Post(':id/charts')
  @HttpCode(201)
  @Roles(Role.MANAGER, Role.TEAMLEAD)
  @ApiOperation({ summary: 'Add charts to an existing worklist — detailed rows and/or N blank placeholders.' })
  addCharts(@Param('id', ParseIntPipe) id: number, @Body() dto: AddChartsDto) {
    return this.bulk.addCharts(id, dto);
  }

  /* ── Bulk: Excel preview (no writes) ─────────────────── */
  @Post(':id/charts/bulk-preview')
  @Roles(Role.MANAGER, Role.TEAMLEAD)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: BULK_MAX_FILE_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Parse + validate the bulk-import Excel without inserting (returns preview).' })
  bulkPreview(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException({ error: { code: 'bad_request', message: 'No file uploaded.' } });
    return this.bulk.preview(id, file);
  }

  /* ── Bulk: Excel import (transactional insert) ───────── */
  @Post(':id/charts/bulk-import')
  @Roles(Role.MANAGER, Role.TEAMLEAD)
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: BULK_MAX_FILE_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Insert charts from a validated Excel into the worklist.' })
  bulkImport(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException({ error: { code: 'bad_request', message: 'No file uploaded.' } });
    return this.bulk.import(id, file);
  }

  /* ── Bulk: trigger AI pipeline on every eligible chart ── */
  @Post(':id/charts/run-ai')
  @Roles(Role.MANAGER, Role.TEAMLEAD)
  @ApiOperation({
    summary: 'Pre-warm AI predictions for every chart in the worklist with uploaded documents.',
  })
  bulkRunAi(@Param('id', ParseIntPipe) id: number) {
    return this.bulk.runAiOnWorklist(id);
  }

  /* ── Bulk: clear stuck AI pipeline state ─────────────── */
  @Post(':id/charts/clear-stuck-ai')
  @Roles(Role.MANAGER, Role.TEAMLEAD)
  @ApiOperation({
    summary: 'Wipe pendingPrediction / aiPredictionError from every chart in the worklist (manual reset for hung gateway runs).',
  })
  bulkClearStuckAi(@Param('id', ParseIntPipe) id: number) {
    return this.bulk.clearStuckAiRuns(id);
  }

  /* ── Bulk: assign staged (already-uploaded) files to charts ── */
  @Post(':id/charts/bulk-documents/assign-staged')
  @Roles(Role.MANAGER, Role.TEAMLEAD)
  @ApiOperation({
    summary: 'Attach previously-staged unmatched files to charts (drag-drop assignment).',
  })
  bulkAssignStaged(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: {
      assignments: Array<{
        stagedKey: string;
        stagedUrl: string;
        filename: string;
        mimeType: string;
        size: number;
        chartId: string | number;
      }>;
    },
  ) {
    return this.bulk.assignStaged(id, body?.assignments ?? []);
  }

  /* ── Bulk: document upload + matching ──────────────────── */
  @Post(':id/charts/bulk-documents')
  @Roles(Role.MANAGER, Role.TEAMLEAD)
  @UseInterceptors(FilesInterceptor('files', BULK_MAX_FILES, { limits: { fileSize: BULK_MAX_FILE_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
        manualMappings: {
          type: 'string',
          description: 'JSON array: [{ filename, chartId }]. Used to resolve previously-unmatched files.',
        },
      },
    },
  })
  @ApiOperation({ summary: 'Upload documents (ZIP and/or loose files) and auto-match them to charts.' })
  bulkDocuments(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFiles() files: Express.Multer.File[],
    @Body('manualMappings') manualMappingsRaw?: string,
  ) {
    let manualMappings: Array<{ filename: string; chartId: string }> = [];
    if (manualMappingsRaw) {
      try {
        const parsed = JSON.parse(manualMappingsRaw);
        if (Array.isArray(parsed)) manualMappings = parsed;
      } catch {
        throw new BadRequestException({
          error: { code: 'bad_request', message: 'manualMappings must be valid JSON: [{ filename, chartId }, ...]' },
        });
      }
    }
    return this.bulk.uploadDocuments(id, files, manualMappings);
  }
}

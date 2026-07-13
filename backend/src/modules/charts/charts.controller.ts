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
  UseGuards,
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
import { SaveCodeDecisionDraftDto, SubmitCodeDecisionsDto } from './dto/code-decisions.dto';
import { SubmitCodeAuditsDto } from './dto/code-audits.dto';
import { QueryAllocationHistoryDto } from './dto/query-allocation-history.dto';
import { ManagerOnlyGuard } from '../../common/guards/manager-only.guard';
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
  summary(
    @CurrentUser() user: AuthenticatedUser,
    @Query() q: QueryChartsDto,
  ) {
    return this.svc.summary(user, q);
  }

  @Get('active-timer')
  @Roles(Role.CODER, Role.AUDITOR, Role.TEAMLEAD)
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
  bulkModify(@Body() dto: BulkModifyDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.bulkModify(dto, user);
  }

  @Post('bulk/self-allocate')
  @Roles(Role.CODER, Role.AUDITOR, Role.TEAMLEAD)
  @ApiOperation({ summary: 'Self Allocation — coder / auditor / admin pulls charts to themselves (admin takes both slots; charts with a running timer are skipped).' })
  selfAllocate(@Body() dto: BulkIdsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.selfAllocate(dto.chartIds, user);
  }

  @Delete('bulk')
  @Roles(Role.MANAGER, Role.TEAMLEAD)
  @ApiOperation({ summary: 'Bulk soft-delete charts.' })
  bulkDelete(@Body() dto: BulkIdsDto) {
    return this.svc.bulkDelete(dto.chartIds);
  }

  // Declared before the `:id` routes so the static path wins over `:id`
  // (otherwise ParseIntPipe would reject "allocation-history" as a chart id).
  @Get('allocation-history')
  @UseGuards(ManagerOnlyGuard)
  @ApiOperation({ summary: 'Manager-only global audit trail of coder/auditor allocation changes across all charts.' })
  allocationHistoryList(@Query() q: QueryAllocationHistoryDto) {
    return this.svc.allocationHistoryList(q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Full chart detail for the coding editor.' })
  detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.detail(id, user);
  }

  @Get(':id/allocation-history')
  @ApiOperation({ summary: "A chart's coder/auditor allocation history: who it moved from/to, who did it, and how." })
  allocationHistory(@Param('id', ParseIntPipe) id: number) {
    return this.svc.allocationHistory(id);
  }

  @Get(':id/time-logs')
  @ApiOperation({ summary: 'Per-session time logged on this chart (one row per start→stop) for the Time Tracker.' })
  timeLogs(@Param('id', ParseIntPipe) id: number) {
    return this.svc.chartTimeSessions(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Persist coder / auditor edits (auto-save).' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateChartDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.update(id, dto, user);
  }

  @Post(':id/start')
  @Roles(Role.CODER, Role.AUDITOR, Role.TEAMLEAD)
  @HttpCode(200)
  @ApiOperation({ summary: 'Start the coding / audit timer.' })
  start(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.startTimer(id, user);
  }

  @Post(':id/stop')
  @Roles(Role.CODER, Role.AUDITOR, Role.TEAMLEAD)
  @HttpCode(200)
  @ApiOperation({ summary: 'Stop the active timer; returns elapsed milliseconds.' })
  stop(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.stopTimer(id, user);
  }

  @Post(':id/pause')
  @Roles(Role.CODER, Role.AUDITOR, Role.TEAMLEAD)
  @HttpCode(200)
  @ApiOperation({ summary: 'Pause the active timer (break) — locks editing / Save / Review until resumed.' })
  pause(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.pauseTimer(id, user);
  }

  @Post(':id/resume')
  @Roles(Role.CODER, Role.AUDITOR, Role.TEAMLEAD)
  @HttpCode(200)
  @ApiOperation({ summary: 'Resume a paused timer — clears the pause flag and starts a fresh session.' })
  resume(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.resumeTimer(id, user);
  }

  @Post(':id/transition')
  @Roles(Role.CODER, Role.AUDITOR, Role.TEAMLEAD)
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
  @Roles(Role.CODER, Role.AUDITOR, Role.TEAMLEAD)
  @HttpCode(201)
  @ApiOperation({ summary: 'Add a Conversation Log comment (coder, auditor, or team lead).' })
  addFeedback(@Param('id', ParseIntPipe) id: number, @Body() dto: ChartFeedbackDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.addFeedback(id, dto, user);
  }

  @Patch('feedback/:feedbackId')
  @Roles(Role.CODER, Role.AUDITOR, Role.TEAMLEAD)
  @ApiOperation({ summary: 'Edit a Conversation Log comment (author only) or record a coder feedback response (Agree / Reject / Implement).' })
  updateFeedback(
    @Param('feedbackId', ParseIntPipe) feedbackId: number,
    @Body() dto: UpdateFeedbackDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.svc.updateFeedback(feedbackId, dto, user);
  }

  /**
   * Phase 1 — kick off the ICD Predictor encounter flow.
   *
   * The frontend POSTs multipart/form-data with N `files` plus a comma-
   * separated `reportTypes` (HP, DISCHARGE_SUMMARY, …) in the SAME order.
   * This endpoint persists each upload to S3, creates a gateway encounter,
   * and queues the AI run, then returns 202 with `{ encounterId, taskId }`.
   * The frontend is expected to poll `…/process-documents/:encounterId/status`
   * until SUCCESS, then call `…/process-documents/:encounterId/finalize` to
   * load the predicted codes. Splitting the flow keeps every individual
   * request well under any reverse-proxy read timeout (the old single-shot
   * version held the connection open for 2+ minutes and 504'd at the edge).
   */
  @Post(':id/process-documents')
  @Roles(Role.CODER, Role.AUDITOR, Role.TEAMLEAD, Role.MANAGER)
  @HttpCode(202)
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
  @ApiOperation({ summary: 'Start ICD Predictor encounter flow; returns encounterId + taskId for polling.' })
  startProcessDocuments(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: ProcessDocumentsDto,
  ) {
    if (!files?.length) {
      throw new BadRequestException({ error: { code: 'bad_request', message: 'No files uploaded.' } });
    }
    return this.svc.startProcessDocuments(id, files, body);
  }

  /** Phase 2 — pass-through to the gateway's task-status endpoint. */
  @Get(':id/process-documents/:encounterId/status')
  @Roles(Role.CODER, Role.AUDITOR, Role.TEAMLEAD, Role.MANAGER)
  @ApiOperation({ summary: 'Poll the AI pipeline status for an in-flight encounter.' })
  getProcessDocumentsStatus(
    @Param('id', ParseIntPipe) id: number,
    @Param('encounterId') encounterId: string,
    @Query('taskId') taskId: string,
  ) {
    if (!taskId) {
      throw new BadRequestException({ error: { code: 'bad_request', message: 'taskId is required.' } });
    }
    return this.svc.getProcessDocumentsStatus(id, encounterId, taskId);
  }

  @Get(':id/code-decisions')
  @ApiOperation({ summary: 'Existing per-code Review & Edit decisions for a chart.' })
  listCodeDecisions(@Param('id', ParseIntPipe) id: number) {
    return this.svc.listCodeDecisions(id);
  }

  @Get(':id/predicted-codes')
  @ApiOperation({ summary: 'Predicted codes WITH the orchestrator UUIDs (predicted_code_id). Used by the Review modal so submissions can carry stable IDs.' })
  getPredictedCodes(@Param('id', ParseIntPipe) id: number) {
    return this.svc.getPredictedCodesForChart(id);
  }

  /* Draft endpoints — autosaved pre-submission Review & Edit state. Scoped to
   * the calling user (per-user drafts); same roles as the submit endpoint
   * because a draft only exists on the way to a submit. */

  @Get(':id/code-decisions/draft')
  @Roles(Role.CODER, Role.AUDITOR, Role.TEAMLEAD, Role.MANAGER)
  @ApiOperation({
    summary:
      "In-progress Review & Edit draft for this chart (draft: null when none). Defaults to the current user's own draft; a Team Lead / Manager may pass ?userId= to watch a specific coder's live draft (QA Live mode).",
  })
  getCodeDecisionDraft(
    @Param('id', ParseIntPipe) id: number,
    @Query('userId') userId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.svc.getCodeDecisionDraft(id, user, userId ? Number(userId) : undefined);
  }

  @Put(':id/code-decisions/draft')
  @Roles(Role.CODER, Role.AUDITOR, Role.TEAMLEAD)
  @ApiOperation({ summary: 'Autosave (upsert) the in-progress Review & Edit draft for the current user.' })
  saveCodeDecisionDraft(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveCodeDecisionDraftDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.svc.saveCodeDecisionDraft(id, dto, user);
  }

  @Delete(':id/code-decisions/draft')
  @Roles(Role.CODER, Role.AUDITOR, Role.TEAMLEAD)
  @ApiOperation({ summary: "Discard the current user's in-progress Review & Edit draft for this chart." })
  deleteCodeDecisionDraft(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.svc.deleteCodeDecisionDraft(id, user);
  }

  @Post(':id/code-decisions')
  @Roles(Role.CODER, Role.AUDITOR, Role.TEAMLEAD)
  @HttpCode(200)
  @ApiOperation({ summary: 'Persist Review & Edit decisions submitted from the modal. Validates reasons against active code-review-reasons. Also forwards to the orchestrator so EDIT/DELETE/ADD reach the golden dataset.' })
  submitCodeDecisions(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SubmitCodeDecisionsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.svc.submitCodeDecisions(id, dto, user);
  }

  @Get(':id/neighbors')
  @Roles(Role.CODER, Role.AUDITOR, Role.TEAMLEAD, Role.MANAGER)
  @ApiOperation({ summary: "Prev/next chart ids in the Charts grid's current filter/search/sort order (spans pages), for the detail page's Previous/Next navigation." })
  neighbors(
    @Param('id', ParseIntPipe) id: number,
    @Query() q: QueryChartsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.svc.neighbors(id, q, user);
  }

  /* Per-code auditor audits — the auditor's Agree/Disagree judgment of each
   * coder decision, layered on top of the (untouched) coder decisions. */

  @Get(':id/code-audits')
  // CODER included so coders can see the auditor's per-code feedback on their
  // own work once the audit is submitted (read-only; POST stays auditor-side).
  @Roles(Role.CODER, Role.AUDITOR, Role.TEAMLEAD, Role.MANAGER)
  @ApiOperation({ summary: "Existing auditor audits (Agree/Disagree per code) for a chart." })
  listCodeAudits(@Param('id', ParseIntPipe) id: number) {
    return this.svc.listCodeAudits(id);
  }

  @Post(':id/code-audits')
  @Roles(Role.AUDITOR, Role.TEAMLEAD)
  @HttpCode(200)
  @ApiOperation({ summary: 'Persist auditor audits submitted from the Review & Edit modal. DISAGREE requires a feedback category + note (≥20 chars). Any DISAGREE re-allocates the chart to its coder and bumps priority to HIGH so it resurfaces on their queue. Does NOT mutate the coder decisions and is not forwarded to the AI gateway.' })
  submitCodeAudits(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SubmitCodeAuditsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.svc.submitCodeAudits(id, dto, user);
  }

  /** Phase 3 — fetch the final codes once the FE has seen status=SUCCESS. */
  @Post(':id/process-documents/:encounterId/finalize')
  @Roles(Role.CODER, Role.AUDITOR, Role.TEAMLEAD, Role.MANAGER)
  @HttpCode(200)
  @ApiOperation({ summary: 'Pull final ICD codes from gateway and persist them on the chart.' })
  finalizeProcessDocuments(
    @Param('id', ParseIntPipe) id: number,
    @Param('encounterId') encounterId: string,
  ) {
    return this.svc.finalizeProcessDocuments(id, encounterId);
  }

  /**
   * Add documents to a chart WITHOUT running the AI pipeline. Lets the user
   * curate the set before a (re)run — pair with DELETE :id/documents/:docId to
   * remove and POST :id/reprocess to run over the whole set.
   */
  @Post(':id/documents')
  @Roles(Role.CODER, Role.AUDITOR, Role.TEAMLEAD, Role.MANAGER)
  @HttpCode(200)
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
  @ApiOperation({ summary: 'Upload documents to a chart (no AI run). Returns the updated uploadedDocs list.' })
  addDocuments(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: ProcessDocumentsDto,
  ) {
    if (!files?.length) {
      throw new BadRequestException({ error: { code: 'bad_request', message: 'No files uploaded.' } });
    }
    return this.svc.addDocuments(id, files, body);
  }

  /** Remove one uploaded document (drops it from the chart + deletes the S3 object). */
  @Delete(':id/documents/:docId')
  @Roles(Role.CODER, Role.AUDITOR, Role.TEAMLEAD, Role.MANAGER)
  @ApiOperation({ summary: 'Remove an uploaded document from a chart. Returns the updated uploadedDocs list.' })
  removeDocument(
    @Param('id', ParseIntPipe) id: number,
    @Param('docId') docId: string,
  ) {
    return this.svc.removeDocument(id, docId);
  }

  /**
   * Re-run the ICD Predictor over the chart's current document set without
   * re-uploading. Returns { encounterId, taskId } so the FE reuses the same
   * poll → finalize flow as the initial run.
   */
  @Post(':id/reprocess')
  @Roles(Role.CODER, Role.AUDITOR, Role.TEAMLEAD, Role.MANAGER)
  @HttpCode(202)
  @ApiOperation({ summary: 'Retry AI processing over the chart\'s current documents; returns encounterId + taskId.' })
  reprocess(@Param('id', ParseIntPipe) id: number) {
    return this.svc.reprocess(id);
  }
}

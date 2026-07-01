import { Controller, Get, HttpCode, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { QaService } from './qa.service';
import { QaFiltersDto, QaSubmissionsQueryDto } from './dto/qa-filters.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/roles.enum';
import { AuthenticatedUser } from '../../common/types/request-user.type';

@ApiTags('Quality Assurance')
@ApiBearerAuth('bearerAuth')
@Controller('qa')
@Roles(Role.TEAMLEAD, Role.MANAGER)
export class QaController {
  constructor(private readonly svc: QaService) {}

  @Get('submissions')
  @ApiOperation({
    summary:
      'Submitted charts (any chart with ≥1 chart_code_decision row), grouped by chart, sorted by latest submission first. Filterable by client/location/specialty/milestone/coder/auditor/q/date.',
  })
  submissions(@Query() q: QaSubmissionsQueryDto) {
    return this.svc.submissions(q);
  }

  @Get('submissions/export.xlsx')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Download submitted charts (one row per chart / encounter) as an .xlsx, including the AI-pipeline encounter id (custom_fields.aiPrediction.encounterId). Same filter shape as /qa/submissions; unpaginated, capped at 50k rows. Used by the AI Analytics encounter export.',
  })
  async exportSubmissionsXlsx(
    @Query() q: QaFiltersDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, rowCount } = await this.svc.exportEncountersXlsx(q);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="ai-encounters-${stamp}.xlsx"`);
    res.setHeader('Content-Length', buffer.length.toString());
    res.setHeader('X-Row-Count', String(rowCount));
    res.setHeader('Access-Control-Expose-Headers', 'X-Row-Count');
    return new StreamableFile(buffer);
  }

  @Get('ai-accuracy')
  @ApiOperation({
    summary:
      'AI accuracy aggregates: KPI tiles + per-codeType acceptance matrix + top reject reasons + weekly trend + daily volume. Same filter shape as /qa/submissions.',
  })
  aiAccuracy(@Query() q: QaFiltersDto) {
    return this.svc.aiAccuracy(q);
  }

  @Get('ai-accuracy/breakdown')
  @ApiOperation({
    summary:
      'AI activity broken down by client × location × sub-speciality, each with its own decision/chart counts and verdict mix (acceptance rate). Same filter shape as /qa/ai-accuracy; the AI Analytics page drives it with its own date window. Ordered by volume, capped at 200 groups.',
  })
  aiActivityBreakdown(@Query() q: QaFiltersDto) {
    return this.svc.aiActivityBreakdown(q);
  }

  @Get('live')
  @ApiOperation({
    summary:
      'Live mode: in-progress code-decision drafts (charts being worked on right now) for QA to watch coders/auditors in real time. Sourced from chart_code_decision_drafts touched in the last 30 min; excludes the caller and soft-deleted/orphaned charts. Returns serverNow + the raw versioned draft payloads.',
  })
  live(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.live(user.id);
  }

  @Get('coders')
  @ApiOperation({ summary: 'Distinct coders/auditors that have submitted at least one decision — for the filter dropdown.' })
  coders() {
    return this.svc.coders();
  }

  @Get('worklists')
  @ApiOperation({ summary: 'Distinct worklists with at least one submitted chart (optionally scoped by client, filtered by `search` on worklist number, capped by `limit`) — for the worklist filter dropdown.' })
  worklists(@Query() q: { clientId?: string; search?: string; limit?: string }) {
    return this.svc.worklists(
      q.clientId ? Number(q.clientId) : undefined,
      q.search,
      q.limit ? Number(q.limit) : undefined,
    );
  }

  @Get('facilities')
  @ApiOperation({ summary: 'Distinct facility values present on charts (optionally scoped by client/location) — for the filter dropdown.' })
  facilities(@Query() q: { clientId?: string; locationId?: string }) {
    return this.svc.facilities(
      q.clientId ? Number(q.clientId) : undefined,
      q.locationId ? Number(q.locationId) : undefined,
    );
  }
}

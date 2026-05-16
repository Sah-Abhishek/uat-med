import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AdminCodeDecisionsService } from './admin-code-decisions.service';
import { ListCodeDecisionsDto } from './dto/list-code-decisions.dto';
import { ListChartsWithDecisionsDto } from './dto/list-charts-with-decisions.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/roles.enum';

@ApiTags('Admin · Code decisions')
@ApiBearerAuth('bearerAuth')
@Controller('admin/code-decisions')
@Roles(Role.TEAMLEAD, Role.MANAGER)
export class AdminCodeDecisionsController {
  constructor(private readonly svc: AdminCodeDecisionsService) {}

  /* ── Chart-centric routes (primary UI surface) ────────────── */

  @Get('charts')
  @ApiOperation({
    summary:
      'Charts with at least one decision, aggregated. Each row carries decision counts, the reviewers involved, and the synced/not-synced split.',
  })
  listCharts(@Query() q: ListChartsWithDecisionsDto) {
    return this.svc.listCharts(q);
  }

  @Get('charts/:chartId')
  @ApiOperation({
    summary:
      "One chart's metadata, the AI's predicted codes (live from the gateway), and every coder decision joined with its gateway correction row.",
  })
  chartDetail(@Param('chartId', ParseIntPipe) chartId: number) {
    return this.svc.chartDetail(chartId);
  }

  /* ── Flat-decision routes (kept for cross-chart audits) ───── */

  @Get()
  @ApiOperation({
    summary:
      'Flat list of decisions across every chart. Filterable by chart, coder, decision, date. Useful for cross-chart audits.',
  })
  list(@Query() q: ListCodeDecisionsDto) {
    return this.svc.list(q);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      "Single decision with the matching gateway correction (if any). Round-trips through /admin/corrections/{id} for a fresh sync state.",
  })
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.svc.detail(id);
  }
}

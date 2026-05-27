import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { QaService } from './qa.service';
import { QaFiltersDto, QaSubmissionsQueryDto } from './dto/qa-filters.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/roles.enum';

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

  @Get('ai-accuracy')
  @ApiOperation({
    summary:
      'AI accuracy aggregates: KPI tiles + per-codeType acceptance matrix + top reject reasons + weekly trend + daily volume. Same filter shape as /qa/submissions.',
  })
  aiAccuracy(@Query() q: QaFiltersDto) {
    return this.svc.aiAccuracy(q);
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

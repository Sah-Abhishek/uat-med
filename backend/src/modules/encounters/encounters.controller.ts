import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { EncountersService } from './encounters.service';
import { QueryEncountersDto } from './dto/query-encounters.dto';

@ApiTags('Encounters')
@ApiBearerAuth('bearerAuth')
@Controller('encounters')
export class EncountersController {
  constructor(private readonly svc: EncountersService) {}

  // No @Public() → the global JwtAuthGuard protects this route (any
  // authenticated user). No @Roles() → not restricted to specific roles.
  @Get()
  @ApiOperation({
    summary:
      'JWT-guarded list of AI-pipeline encounter ids with their sub-speciality, client, location and date-of-coding. Optional client/location/sub-speciality and coding-date-range filters; paginated.',
  })
  list(@Query() q: QueryEncountersDto) {
    return this.svc.list(q);
  }
}

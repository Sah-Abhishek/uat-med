import { Controller, Get, Logger, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ReferenceCodesService } from './reference-codes.service';
import { SearchCodesDto } from './dto/search-codes.dto';

/**
 * Read-only PCS / DRG reference lookups for the Chart Info code autocompletes.
 * No `@Roles` → available to every authenticated user (coders use them while
 * filling a chart). Search failures degrade to empty results so the typing
 * experience is never broken by a reference-DB hiccup.
 */
@ApiTags('Reference Codes')
@ApiBearerAuth('bearerAuth')
@Controller()
export class ReferenceCodesController {
  private readonly logger = new Logger(ReferenceCodesController.name);

  constructor(private readonly service: ReferenceCodesService) {}

  @Get('pcs-codes/search')
  @ApiOperation({ summary: 'Prefix-search ICD-10-PCS codes for the Chart Info autocomplete. Fires at ≥2 chars.' })
  async searchPcs(@Query() query: SearchCodesDto) {
    try {
      return { codes: await this.service.searchPcs(query.q, query.limit) };
    } catch (err) {
      this.logger.warn(`PCS code search failed for "${query.q}": ${(err as Error).message}`);
      return { codes: [] };
    }
  }

  @Get('drg-codes/search')
  @ApiOperation({ summary: 'Prefix-search MS-DRG codes for the Chart Info autocomplete. Fires at ≥2 chars.' })
  async searchDrg(@Query() query: SearchCodesDto) {
    try {
      return { codes: await this.service.searchDrg(query.q, query.limit) };
    } catch (err) {
      this.logger.warn(`DRG code search failed for "${query.q}": ${(err as Error).message}`);
      return { codes: [] };
    }
  }
}

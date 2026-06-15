import { Controller, Get, Logger, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { IcdCodesService } from './icd-codes.service';
import { SearchIcdCodesDto } from './dto/search-icd-codes.dto';

/**
 * ICD-10-CM reference lookups. No `@Roles` decorator → available to every
 * authenticated user (coders/auditors use it from the Review & Edit modal).
 */
@ApiTags('ICD Codes')
@ApiBearerAuth('bearerAuth')
@Controller('icd-codes')
export class IcdCodesController {
  private readonly logger = new Logger(IcdCodesController.name);

  constructor(private readonly service: IcdCodesService) {}

  @Get('search')
  @ApiOperation({
    summary:
      'Prefix-search ICD-10-CM codes for the "Add a code" autocomplete. Fires at ≥2 chars.',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        codes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'E11.9' },
              description: {
                type: 'string',
                example: 'Type 2 diabetes mellitus without complications',
              },
              isBillable: { type: 'boolean', example: true },
            },
          },
        },
      },
    },
  })
  async search(@Query() query: SearchIcdCodesDto) {
    try {
      const codes = await this.service.search(query.q, query.limit);
      return { codes };
    } catch (err) {
      // Autocomplete is a non-critical enhancement — never break the typing
      // experience over a reference-DB hiccup. Log and degrade to no results.
      this.logger.warn(
        `ICD code search failed for "${query.q}": ${(err as Error).message}`,
      );
      return { codes: [] };
    }
  }
}

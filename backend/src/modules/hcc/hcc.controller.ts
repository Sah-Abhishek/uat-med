import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { HccService } from './hcc.service';
import { CreateHccRecordDto } from './dto/create-hcc-record.dto';
import { QueryHccDto } from './dto/query-hcc.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/roles.enum';
import { AuthenticatedUser } from '../../common/types/request-user.type';

@ApiTags('HCC')
@ApiBearerAuth('bearerAuth')
@Controller('hcc')
export class HccController {
  constructor(private readonly svc: HccService) {}

  @Get('records')
  @ApiOperation({ summary: 'Paginated HCC record grid.' })
  list(@Query() q: QueryHccDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.list(q, user);
  }

  @Post('records')
  @Roles(Role.CODER)
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a single HCC record.' })
  create(@Body() dto: CreateHccRecordDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.create(dto, user);
  }

  @Post('records/save-and-next')
  @Roles(Role.CODER)
  @HttpCode(201)
  @ApiOperation({ summary: 'Save current record and return template for next with preserve_next fields pre-filled.' })
  saveAndNext(@Body() dto: CreateHccRecordDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.saveAndNext(dto, user);
  }

  @Get('records/:id')
  @ApiOperation({ summary: 'Fetch a single record.' })
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.svc.detail(id);
  }

  @Patch('records/:id')
  @ApiOperation({ summary: 'Update a record.' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: Partial<CreateHccRecordDto>) {
    return this.svc.update(id, dto);
  }

  @Delete('records/:id')
  @Roles(Role.MANAGER)
  @ApiOperation({ summary: 'Soft-delete an HCC record.' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.svc.remove(id);
  }

  @Get('fields')
  @ApiOperation({ summary: 'Active HCC custom field definitions.' })
  fields() {
    return this.svc.fields();
  }
}

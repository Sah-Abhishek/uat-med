import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { WorklistsService } from './worklists.service';
import { CreateWorklistDto } from './dto/create-worklist.dto';
import { UpdateWorklistDto } from './dto/update-worklist.dto';
import { QueryWorklistsDto } from './dto/query-worklists.dto';
import { AllocateWorklistDto } from './dto/allocate-worklist.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/roles.enum';
import { AuthenticatedUser } from '../../common/types/request-user.type';

@ApiTags('Worklists')
@ApiBearerAuth('bearerAuth')
@Controller('worklists')
export class WorklistsController {
  constructor(private readonly svc: WorklistsService) {}

  @Get()
  @ApiOperation({ summary: 'Paginated, filtered, sortable worklist list.' })
  list(@Query() q: QueryWorklistsDto) {
    return this.svc.list(q);
  }

  @Get('status-summary')
  @ApiOperation({ summary: 'Counters for the three status cards (OPEN / IN_PROGRESS / CLOSED).' })
  statusSummary() {
    return this.svc.statusSummary();
  }

  @Post()
  @HttpCode(201)
  @Roles(Role.MANAGER)
  @ApiOperation({ summary: 'Add Volume — create a worklist.' })
  create(@Body() dto: CreateWorklistDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.create(dto, user.id);
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
}

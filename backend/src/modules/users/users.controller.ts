import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { MarkAttendanceDto } from './dto/attendance.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/roles.enum';
import { AuthenticatedUser } from '../../common/types/request-user.type';
import { UserStatus } from '../../common/enums';

@ApiTags('Users')
@ApiBearerAuth('bearerAuth')
@Controller('users')
export class UsersController {
  constructor(private readonly svc: UsersService) {}

  @Get()
  @Roles(Role.MANAGER)
  @ApiOperation({ summary: 'Paginated user list. Filter by status for Active/Inactive/Pending tabs.' })
  list(@Query() q: { page?: number; pageSize?: number; status?: UserStatus; role?: Role; search?: string }) {
    return this.svc.list(q);
  }

  @Get('stats')
  @Roles(Role.MANAGER)
  @ApiOperation({ summary: 'Counts for the three user tabs.' })
  stats() {
    return this.svc.stats();
  }

  @Post()
  @Roles(Role.ADMIN)
  @HttpCode(201)
  @ApiOperation({ summary: 'Admin creates a user directly (bypasses signup).' })
  create(@Body() dto: CreateUserDto) {
    return this.svc.create(dto);
  }

  @Get('signup-requests')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Pending signup approval queue.' })
  signupRequests() {
    return this.svc.signupRequests();
  }

  @Post('signup-requests/:id/approve')
  @Roles(Role.ADMIN)
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve a pending request and provision the user.' })
  approve(@Param('id', ParseIntPipe) id: number, @Body() body: CreateUserDto) {
    return this.svc.approveSignup(id, body);
  }

  @Post('signup-requests/:id/decline')
  @Roles(Role.ADMIN)
  @HttpCode(200)
  @ApiOperation({ summary: 'Decline a signup request with a reason.' })
  decline(@Param('id', ParseIntPipe) id: number, @Body('reason') reason: string) {
    return this.svc.declineSignup(id, reason);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Full profile for a user.' })
  detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.detail(id, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a user profile (self or admin).' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.update(id, dto, user);
  }

  @Post(':id/deactivate')
  @Roles(Role.ADMIN)
  @HttpCode(200)
  @ApiOperation({ summary: 'Deactivate a user and revoke tokens.' })
  deactivate(@Param('id', ParseIntPipe) id: number, @Body('reason') reason?: string) {
    return this.svc.deactivate(id, reason);
  }

  @Post(':id/activate')
  @Roles(Role.ADMIN)
  @HttpCode(200)
  activate(@Param('id', ParseIntPipe) id: number) {
    return this.svc.activate(id);
  }

  @Get(':id/attendance')
  @ApiOperation({ summary: 'Month-view attendance.' })
  attendance(@Param('id', ParseIntPipe) id: number, @Query('month') month: string) {
    return this.svc.attendance(id, month);
  }

  @Post(':id/attendance/mark')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark a day. Self-mark restricted to today.' })
  markAttendance(@Param('id', ParseIntPipe) id: number, @Body() dto: MarkAttendanceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.markAttendance(id, dto, user);
  }
}

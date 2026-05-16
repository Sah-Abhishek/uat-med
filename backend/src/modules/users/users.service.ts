import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, ILike, Repository } from 'typeorm';
import { User } from '../../entities/user.entity';
import { Attendance } from '../../entities/attendance.entity';
import { UserSignupRequest } from '../../entities/user-signup-request.entity';
import { AttendanceStatus, UserStatus } from '../../common/enums';
import { Role } from '../../common/enums/roles.enum';
import { AuthenticatedUser } from '../../common/types/request-user.type';
import { AuthService } from '../auth/auth.service';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { MarkAttendanceDto } from './dto/attendance.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Attendance) private readonly attendanceRepo: Repository<Attendance>,
    @InjectRepository(UserSignupRequest) private readonly signups: Repository<UserSignupRequest>,
    private readonly auth: AuthService,
  ) { }

  async list(q: { page?: number; pageSize?: number; status?: UserStatus; role?: Role; search?: string }) {
    const page = q.page ?? 1, pageSize = q.pageSize ?? 20;
    const where: any = {};
    if (q.status) where.status = q.status;
    if (q.role) where.role = q.role;
    if (q.search) where.fullName = ILike(`%${q.search}%`);
    const [items, total] = await this.users.findAndCount({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      order: { createdAt: 'DESC' },
    });
    return new PaginatedResponseDto(items, total, page, pageSize);
  }

  /**
   * Stats for the Users-list tabs.
   *
   * `active` / `inactive` come from the `users` table.
   * `pending` comes from `user_signup_requests` — signup requests are NOT users yet,
   * they live in a separate table as an approval queue.
   */
  async stats() {
    const [statusRows, pendingCount] = await Promise.all([
      this.users.createQueryBuilder('u')
        .select('u.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .groupBy('u.status')
        .getRawMany(),
      this.signups.count({ where: { status: 'PENDING' } }),
    ]);

    const out = { active: 0, inactive: 0, pending: pendingCount };
    statusRows.forEach(r => {
      if (r.status === UserStatus.ACTIVE) out.active = Number(r.count);
      if (r.status === UserStatus.INACTIVE) out.inactive = Number(r.count);
    });
    return out;
  }

  async create(dto: CreateUserDto) {
    return this.auth.createUserWithPassword(dto).then(u => ({ id: u.id }));
  }

  async detail(id: number, caller: AuthenticatedUser) {
    if (caller.role !== Role.TEAMLEAD && caller.role !== Role.MANAGER && caller.id !== id) {
      throw new ForbiddenException({ error: { code: 'forbidden', message: 'Cannot view other users.' } });
    }
    const u = await this.users.findOne({ where: { id }, relations: ['client', 'location', 'primarySpeciality'] });
    if (!u) throw new NotFoundException();
    return u;
  }

  async update(id: number, dto: UpdateUserDto, caller: AuthenticatedUser) {
    const u = await this.users.findOne({ where: { id } });
    if (!u) throw new NotFoundException();
    const isSelf = caller.id === id;
    const isAdmin = caller.role === Role.TEAMLEAD;
    if (!isSelf && !isAdmin) throw new ForbiddenException();
    if (isSelf && !isAdmin) {
      ['role', 'status', 'clientId', 'locationId', 'primarySpecialityId', 'designation'].forEach(k => delete (dto as any)[k]);
    }
    Object.assign(u, dto);
    return this.users.save(u);
  }

  async deactivate(id: number, _reason?: string) {
    const u = await this.users.findOne({ where: { id } });
    if (!u) throw new NotFoundException();
    u.status = UserStatus.INACTIVE;
    await this.users.save(u);
    return { status: 'INACTIVE' };
  }

  async activate(id: number) {
    const u = await this.users.findOne({ where: { id } });
    if (!u) throw new NotFoundException();
    u.status = UserStatus.ACTIVE;
    await this.users.save(u);
    return { status: 'ACTIVE' };
  }

  /** Admin-initiated password reset. Logs the user out of every active
   *  session so they're forced onto the new credential immediately. */
  async resetPassword(id: number, newPassword: string) {
    const u = await this.users.findOne({ where: { id } });
    if (!u) throw new NotFoundException();
    return this.auth.resetPasswordFor(id, newPassword);
  }

  async attendance(userId: number, month: string) {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new BadRequestException({ error: { code: 'bad_request', message: 'month must be YYYY-MM' } });
    }
    const [y, m] = month.split('-').map(Number);
    const from = `${month}-01`;
    const toDate = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const rows = await this.attendanceRepo.find({
      where: { userId, date: Between(from, toDate) },
      order: { date: 'ASC' },
    });
    const summary = { presentDays: 0, absentDays: 0, leaveDays: 0 };
    rows.forEach(r => {
      if (r.status === AttendanceStatus.PRESENT) summary.presentDays++;
      else if (r.status === AttendanceStatus.ABSENT) summary.absentDays++;
      else if (r.status === AttendanceStatus.LEAVE) summary.leaveDays++;
    });
    return { month, ...summary, days: rows.map(r => ({ date: r.date, status: r.status })) };
  }

  async markAttendance(userId: number, dto: MarkAttendanceDto, caller: AuthenticatedUser) {
    const today = new Date().toISOString().slice(0, 10);
    const isSelf = caller.id === userId;
    if (isSelf && caller.role !== Role.TEAMLEAD && dto.date !== today) {
      throw new ForbiddenException({ error: { code: 'forbidden', message: 'Self-mark restricted to today.' } });
    }
    const existing = await this.attendanceRepo.findOne({ where: { userId, date: dto.date } });
    if (existing) {
      existing.status = dto.status;
      existing.markedBy = caller.id;
      existing.markedAt = new Date();
      return this.attendanceRepo.save(existing);
    }
    return this.attendanceRepo.save(this.attendanceRepo.create({
      userId, date: dto.date, status: dto.status, markedBy: caller.id, markedAt: new Date(),
    }));
  }

  async signupRequests() {
    const [items, total] = await this.signups.findAndCount({
      where: { status: 'PENDING' },
      order: { createdAt: 'DESC' },
    });
    // Shape signup rows to match the frontend's `SignupRequest` type expectations:
    // frontend expects { id, email, requestedAt } but the entity uses `createdAt`.
    const shaped = items.map(s => ({
      id: String(s.id),
      email: s.email,
      requestedAt: s.createdAt,
    }));
    return new PaginatedResponseDto(shaped, total, 1, Math.max(total, 1));
  }

  async approveSignup(id: number, dto: CreateUserDto) {
    const s = await this.signups.findOne({ where: { id } });
    if (!s || s.status !== 'PENDING') throw new NotFoundException();
    const user = await this.auth.createUserWithPassword({ ...dto, email: dto.email ?? s.email });
    s.status = 'APPROVED';
    s.processedAt = new Date();
    await this.signups.save(s);
    return { userId: user.id, status: 'ACTIVE' };
  }

  async declineSignup(id: number, reason: string) {
    const s = await this.signups.findOne({ where: { id } });
    if (!s) throw new NotFoundException();
    s.status = 'DECLINED';
    s.declineReason = reason;
    s.processedAt = new Date();
    await this.signups.save(s);
    return { status: 'DECLINED' };
  }
}
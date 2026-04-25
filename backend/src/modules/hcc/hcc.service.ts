import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HccRecord } from '../../entities/hcc-record.entity';
import { Role } from '../../common/enums/roles.enum';
import { AuthenticatedUser } from '../../common/types/request-user.type';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { CreateHccRecordDto } from './dto/create-hcc-record.dto';
import { QueryHccDto } from './dto/query-hcc.dto';

@Injectable()
export class HccService {
  constructor(
    @InjectRepository(HccRecord) private readonly records: Repository<HccRecord>,
  ) {}

  async list(q: QueryHccDto, user: AuthenticatedUser) {
    const qb = this.records.createQueryBuilder('h');
    if (user.role === Role.CODER) qb.andWhere('h.coder_id = :uid', { uid: user.id });

    if (q.memberId) qb.andWhere('h.member_id = :mid', { mid: q.memberId });
    if (q.medicareNo) qb.andWhere('h.medicare_no = :mn', { mn: q.medicareNo });
    if (q.coderId) qb.andWhere('h.coder_id = :cid', { cid: q.coderId });
    if (q.v24Icd) qb.andWhere('h.v24_icd = :v24', { v24: q.v24Icd });
    if (q.v28Icd) qb.andWhere('h.v28_icd = :v28', { v28: q.v28Icd });
    if (q.dateOfServiceFrom) qb.andWhere('h.dos >= :df', { df: q.dateOfServiceFrom });
    if (q.dateOfServiceTo) qb.andWhere('h.dos <= :dt', { dt: q.dateOfServiceTo });
    if (q.validate) qb.andWhere('h.validate = :vv', { vv: q.validate });

    qb.orderBy('h.created_at', 'DESC').skip((q.page - 1) * q.pageSize).take(q.pageSize);
    const [items, total] = await qb.getManyAndCount();
    return new PaginatedResponseDto(items, total, q.page, q.pageSize);
  }

  async create(dto: CreateHccRecordDto, user: AuthenticatedUser) {
    const coderId = dto.coderId ?? (user.role === Role.CODER ? user.id : undefined);
    const record = this.records.create({ ...dto, coderId });
    const saved = await this.records.save(record);
    return { id: saved.id };
  }

  async saveAndNext(dto: CreateHccRecordDto, user: AuthenticatedUser) {
    const { id } = await this.create(dto, user);
    // "preserveNext" fields from the custom-field catalog would be pre-filled here.
    // We return a minimal template — memberId, memberName, dob carry over, plus customFields marked preserveNext=true.
    return {
      saved: { id },
      nextTemplate: {
        memberId: dto.memberId,
        memberName: dto.memberName,
        dob: dto.dob,
        coderId: dto.coderId ?? user.id,
        customFields: dto.customFields ?? {},
      },
    };
  }

  async detail(id: number) {
    const r = await this.records.findOne({ where: { id } });
    if (!r) throw new NotFoundException();
    return r;
  }

  async update(id: number, dto: Partial<CreateHccRecordDto>) {
    const r = await this.records.findOne({ where: { id } });
    if (!r) throw new NotFoundException();
    Object.assign(r, dto);
    if (dto.customFields) r.customFields = { ...(r.customFields ?? {}), ...dto.customFields };
    return this.records.save(r);
  }

  async remove(id: number) {
    await this.records.softDelete(id);
    return { status: 'deleted' };
  }

  fields() {
    // Static placeholder catalog — real data comes from custom_field_defs table.
    return [
      { name: 'Number of Appointments taken', type: 'number', isMultiSelect: false, validation: 'NON_MANDATORY', preserveNext: false },
      { name: 'Smoking Status', type: 'dropdown', isMultiSelect: true, validation: 'MANDATORY', preserveNext: true,
        options: ['Smoker', 'Non Smoker', 'Quit Smoking'] },
    ];
  }
}

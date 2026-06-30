import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ObjectLiteral, Repository } from 'typeorm';

import { PcsCode } from '../../entities/pcs-code.entity';
import { DrgCode } from '../../entities/drg-code.entity';

/** A single reference hit returned by the autocomplete endpoints. */
export interface CodeHit {
  code: string;
  description: string;
}

/** Escape LIKE/ILIKE wildcards so a literal % or _ the user types matches
 *  literally (paired with ESCAPE '\' in the query). */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

@Injectable()
export class ReferenceCodesService {
  constructor(
    @InjectRepository(PcsCode) private readonly pcs: Repository<PcsCode>,
    @InjectRepository(DrgCode) private readonly drg: Repository<DrgCode>,
  ) {}

  searchPcs(q: string, limit?: number): Promise<CodeHit[]> {
    return this.search(this.pcs as Repository<ObjectLiteral>, q, limit);
  }

  searchDrg(q: string, limit?: number): Promise<CodeHit[]> {
    return this.search(this.drg as Repository<ObjectLiteral>, q, limit);
  }

  /**
   * Prefix-search a reference table by `code` only (case-insensitive), ordered
   * by code. Returns [] for queries shorter than 2 chars; caps the limit at 25.
   */
  private async search(repo: Repository<ObjectLiteral>, rawQuery: string, limit = 15): Promise<CodeHit[]> {
    const q = (rawQuery ?? '').trim();
    if (q.length < 2) return [];
    const lim = Math.min(Math.max(Math.trunc(limit) || 15, 1), 25);
    return repo
      .createQueryBuilder('c')
      .select('c.code', 'code')
      .addSelect('c.description', 'description')
      .where(`c.code ILIKE :p ESCAPE '\\'`, { p: `${escapeLike(q)}%` })
      .orderBy('c.code', 'ASC')
      .limit(lim)
      .getRawMany<CodeHit>();
  }
}

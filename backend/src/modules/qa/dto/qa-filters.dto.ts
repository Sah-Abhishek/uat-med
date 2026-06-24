import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Coerce a query param that may arrive as a single value, a comma-separated
 * string ("3,7"), or a repeated key (`specialityId[]=3&specialityId[]=7`) into a
 * clean number[]. Numeric ids never contain commas, so splitting on comma is
 * always safe. Returns undefined when nothing usable is present.
 */
const toIntArray = ({ value }: { value: unknown }): number[] | undefined => {
  if (value == null || value === '') return undefined;
  const raw = Array.isArray(value) ? value : String(value).split(',');
  const nums = raw.map((v) => Number(String(v).trim())).filter((n) => Number.isInteger(n));
  return nums.length ? nums : undefined;
};

/**
 * Coerce a string-or-array query param into a clean string[]. Unlike the int
 * variant this never splits on comma — facility names can legitimately contain
 * commas, so a single value is kept whole and multiple values must arrive as a
 * repeated key (`facility[]=A&facility[]=B`).
 */
const toStrArray = ({ value }: { value: unknown }): string[] | undefined => {
  if (value == null || value === '') return undefined;
  const raw = Array.isArray(value) ? value : [value];
  const strs = raw.map((v) => String(v).trim()).filter(Boolean);
  return strs.length ? strs : undefined;
};

export class QaFiltersDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() clientId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() locationId?: number;

  /** One or more primary speciality ids (single value, CSV, or repeated key). */
  @ApiPropertyOptional({ type: [Number] })
  @IsOptional() @Transform(toIntArray) @IsArray() @IsInt({ each: true })
  specialityId?: number[];

  /** One or more sub-speciality ids (worklist.sub_speciality_id). Location-scoped. */
  @ApiPropertyOptional({ type: [Number] })
  @IsOptional() @Transform(toIntArray) @IsArray() @IsInt({ each: true })
  subSpecialityId?: number[];

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() coderId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() auditorId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() worklistId?: number;

  /** Comma-separated list of milestones, e.g. CODING_DONE,AUDIT_DONE. */
  @ApiPropertyOptional() @IsOptional() @IsString() milestone?: string;

  /** One or more facility names (repeated key) as stored on chart.custom_fields.facility. */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @Transform(toStrArray) @IsArray() @IsString({ each: true })
  facility?: string[];

  /** ISO date (YYYY-MM-DD), inclusive. */
  @ApiPropertyOptional() @IsOptional() @IsString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() to?: string;

  /** Free-text chart # search. */
  @ApiPropertyOptional() @IsOptional() @IsString() q?: string;
}

export class QaSubmissionsQueryDto extends QaFiltersDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number = 25;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Multipart body for `POST /charts/:id/process-documents`. The `files`
 * themselves are consumed by FilesInterceptor and don't appear here — this
 * DTO only validates the auxiliary text fields so Nest's ValidationPipe
 * doesn't strip them under whitelist mode.
 */
export class ProcessDocumentsDto {
  @ApiPropertyOptional({
    description:
      'Comma-separated ICD-Predictor report_type values, one per uploaded file in the SAME order. ' +
      'Example: "HP,DISCHARGE_SUMMARY,LAB". Vocabulary: HP | DISCHARGE_SUMMARY | OPERATIVE_NOTE | ' +
      'LAB | RADIOLOGY | ED_NOTE | CLINIC_NOTE | PATHOLOGY.',
  })
  @IsOptional()
  @IsString()
  reportTypes?: string;

  @ApiPropertyOptional({
    description: 'Optional fallback document-type hint used to infer report_type when reportTypes is omitted.',
  })
  @IsOptional()
  @IsString()
  documentType?: string;
}

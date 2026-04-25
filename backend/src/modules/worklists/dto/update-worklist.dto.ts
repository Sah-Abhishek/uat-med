import { PartialType } from '@nestjs/swagger';
import { CreateWorklistDto } from './create-worklist.dto';

export class UpdateWorklistDto extends PartialType(CreateWorklistDto) {}

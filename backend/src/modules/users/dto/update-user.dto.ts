import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';

// Can't change email or password through the generic update endpoint.
export class UpdateUserDto extends PartialType(OmitType(CreateUserDto, ['email', 'password'] as const)) {}

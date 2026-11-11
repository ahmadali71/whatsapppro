import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class SyncContactItemDto {
  @ApiProperty({ example: '+15550100002', description: 'Contact phone number in E.164 format' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+[1-9]\d{6,14}$/, { message: 'phone_number must be in valid E.164 format' })
  phone_number: string;

  @ApiPropertyOptional({ example: 'Bob (Work)', description: 'Optional local contact name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  nickname?: string;
}

export class AddContactDto extends SyncContactItemDto {}

export class SyncContactsDto {
  @ApiProperty({
    type: [SyncContactItemDto],
    description: 'Batch of device contacts to sync with registered users',
  })
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => SyncContactItemDto)
  contacts: SyncContactItemDto[];
}

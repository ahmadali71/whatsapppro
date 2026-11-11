import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateGroupDto {
  @ApiProperty({ description: 'Group name', example: 'Engineering Team' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ description: 'Group description' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'Group avatar URL (alias for avatarUrl)' })
  @IsOptional()
  @IsString()
  avatar?: string;

  @ApiPropertyOptional({ description: 'Group avatar URL' })
  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @ApiProperty({
    type: [String],
    description: 'Initial member user UUIDs to add to the group',
    default: [],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  memberIds: string[] = [];
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { StatusContentType, StatusPrivacy } from '@prisma/client';

export class CreateStatusDto {
  @ApiProperty({
    enum: StatusContentType,
    example: StatusContentType.TEXT,
    description: 'Type of status content (TEXT, IMAGE, VIDEO)',
  })
  @IsOptional()
  @IsEnum(StatusContentType)
  contentType?: StatusContentType;

  @ApiPropertyOptional({
    enum: StatusContentType,
    description: 'Alias for contentType',
  })
  @IsOptional()
  @IsEnum(StatusContentType)
  type?: StatusContentType;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/status/image.jpg',
    description: 'Media URL for IMAGE or VIDEO statuses',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4_000_000)
  contentUrl?: string;

  @ApiPropertyOptional({
    example: 'Having a great day!',
    description: 'Text content for TEXT status',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  textContent?: string;

  @ApiPropertyOptional({
    description: 'Generic content field (mapped to textContent for TEXT or contentUrl for IMAGE/VIDEO)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4_000_000)
  content?: string;

  @ApiPropertyOptional({ example: 'Sunset at the beach', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  caption?: string;

  @ApiPropertyOptional({ example: '#00A884' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  backgroundColor?: string;

  @ApiPropertyOptional({ example: 'sans-serif' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  fontStyle?: string;

  @ApiPropertyOptional({
    enum: StatusPrivacy,
    default: StatusPrivacy.CONTACTS,
    description: 'Who can view this status',
  })
  @IsOptional()
  @IsEnum(StatusPrivacy)
  privacy?: StatusPrivacy;

  @ApiPropertyOptional({
    type: [String],
    description: 'List of user IDs allowed to view when privacy is SELECTED',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  selectedUserIds?: string[];
}

export class ReactStatusDto {
  @ApiProperty({ example: '❤️', description: 'Emoji reaction' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  emoji: string;
}

export class ReplyStatusDto {
  @ApiProperty({ example: 'Love this photo!', description: 'Reply message text' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  message: string;
}

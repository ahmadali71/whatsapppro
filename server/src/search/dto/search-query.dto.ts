import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export type SearchType = 'all' | 'contacts' | 'messages' | 'groups' | 'media';

export class SearchQueryDto {
  @ApiProperty({ example: 'meeting', description: 'Search query string' })
  @IsString()
  @MaxLength(200)
  q: string;

  @ApiPropertyOptional({
    enum: ['all', 'contacts', 'messages', 'groups', 'media'],
    default: 'all',
  })
  @IsOptional()
  @IsIn(['all', 'contacts', 'messages', 'groups', 'media'])
  type?: SearchType = 'all';

  @ApiPropertyOptional({ description: 'Filter by ISO start date' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Filter by ISO end date' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Restrict message/media search to a conversation UUID' })
  @IsOptional()
  @IsUUID('4')
  conversationId?: string;

  @ApiPropertyOptional({ description: 'Optional media type filter (IMAGE, VIDEO, AUDIO, DOCUMENT)' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  mediaType?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

import {
  IsUUID,
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
  IsUrl,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';

export class CreateDirectChatDto {
  @ApiProperty({ description: 'Target user UUID to start a direct chat with' })
  @IsUUID()
  otherUserId: string;
}

export class AddReactionDto {
  @ApiProperty({ description: 'Emoji string to add or toggle' })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  emoji: string;
}

export class DeleteMessageQueryDto {
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  deleteForEveryone?: boolean = false;
}

export class PollVoteDto {
  @ApiPropertyOptional({ description: 'Zero-based option index' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  optionIndex?: number;

  @ApiPropertyOptional({ description: 'Option ID string' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  optionId?: string;
}

export class LinkPreviewQueryDto {
  @ApiProperty({ description: 'HTTP/HTTPS URL to fetch OpenGraph preview for' })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  url: string;
}


import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateReportDto {
  @ApiPropertyOptional({
    description: 'UUID of the reported user',
  })
  @IsOptional()
  @IsUUID('4')
  reportedUserId?: string;

  @ApiPropertyOptional({
    description: 'Optional UUID of the reported message',
  })
  @IsOptional()
  @IsUUID('4')
  messageId?: string;

  @ApiPropertyOptional({
    description: 'Alias for messageId',
  })
  @IsOptional()
  @IsUUID('4')
  reportedMessageId?: string;

  @ApiProperty({
    example: 'SPAM',
    description: 'Reason for reporting (e.g., SPAM, HARASSMENT, SCAM, INAPPROPRIATE_CONTENT)',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  reason: string;

  @ApiPropertyOptional({
    example: 'User is sending repeated unsolicited links.',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

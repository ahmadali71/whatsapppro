import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CallType } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

export class InitiateCallDto {
  @ApiPropertyOptional({
    description: 'Caller user UUID (defaults to authenticated user)',
  })
  @IsOptional()
  @IsUUID()
  callerId?: string;

  @ApiProperty({
    description: 'Conversation UUID for the 1-on-1 or group call',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  conversationId: string;

  @ApiProperty({
    enum: CallType,
    default: CallType.AUDIO,
    description: 'Media type for the WebRTC call',
  })
  @IsEnum(CallType)
  callType: CallType;
}

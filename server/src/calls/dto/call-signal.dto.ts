import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

export class CallSignalDto {
  @ApiPropertyOptional({ description: 'Active call UUID (optional when passed via path)' })
  @IsOptional()
  @IsUUID()
  callId?: string;

  @ApiPropertyOptional({
    description: 'Target peer user UUID (used in 1-on-1 and mesh group calls)',
  })
  @IsOptional()
  @IsUUID()
  toUserId?: string;

  @ApiProperty({
    description:
      'Signaling payload type: offer | answer | ice-candidate | ice_candidate | media_state',
    example: 'offer',
  })
  @IsString()
  type: string;

  @ApiPropertyOptional({
    description: 'Optional Socket.IO event override name',
  })
  @IsOptional()
  @IsString()
  event?: string;

  @ApiPropertyOptional({
    description: 'WebRTC SDP offer payload',
  })
  @IsOptional()
  offer?: unknown;

  @ApiPropertyOptional({
    description: 'WebRTC SDP answer payload',
  })
  @IsOptional()
  answer?: unknown;

  @ApiPropertyOptional({
    description: 'WebRTC SDP session description (offer or answer)',
  })
  @IsOptional()
  sdp?: unknown;

  @ApiPropertyOptional({
    description: 'WebRTC ICE candidate payload',
  })
  @IsOptional()
  candidate?: unknown;

  @ApiPropertyOptional({
    description: 'Generic signaling object payload',
  })
  @IsOptional()
  signal?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Mute state for media_state signal' })
  @IsOptional()
  @IsBoolean()
  isMuted?: boolean;

  @ApiPropertyOptional({ description: 'Video state for media_state signal' })
  @IsOptional()
  @IsBoolean()
  isVideoOn?: boolean;
}

export interface CallOfferPayload {
  callId: string;
  toUserId?: string;
  offer?: unknown;
  sdp?: unknown;
}

export interface CallAnswerPayload {
  callId: string;
  toUserId?: string;
  answer?: unknown;
  sdp?: unknown;
}

export interface IceCandidatePayload {
  callId: string;
  toUserId?: string;
  candidate: unknown;
}

export interface CallActionPayload {
  callId: string;
  reason?: string;
}

export interface CallMediaTogglePayload {
  callId: string;
  isMuted?: boolean;
  isVideoOn?: boolean;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDefined, IsOptional, IsString, IsUUID } from 'class-validator';

export class CallSignalDto {
  @ApiProperty({ description: 'Active call UUID' })
  @IsUUID()
  callId: string;

  @ApiPropertyOptional({
    description: 'Target peer user UUID (used in 1-on-1 and mesh group calls)',
  })
  @IsOptional()
  @IsUUID()
  toUserId?: string;

  @ApiProperty({
    description: 'Signaling payload type: offer | answer | ice_candidate',
    example: 'offer',
  })
  @IsString()
  type: string;

  @ApiProperty({
    description: 'WebRTC SDP offer/answer object or ICE candidate object',
  })
  @IsDefined()
  signal: Record<string, unknown>;
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

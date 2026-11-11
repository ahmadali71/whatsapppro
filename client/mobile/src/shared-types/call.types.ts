import { User } from './user.types';

export enum CallType {
  AUDIO = 'AUDIO',
  VIDEO = 'VIDEO',
}

export enum CallStatus {
  INITIATED = 'INITIATED',
  RINGING = 'RINGING',
  ONGOING = 'ONGOING',
  ENDED = 'ENDED',
  MISSED = 'MISSED',
  REJECTED = 'REJECTED',
}

export interface CallParticipant {
  id: string;
  callId: string;
  userId: string;
  joinedAt?: string | Date | null;
  leftAt?: string | Date | null;
  isMuted: boolean;
  isVideoOn: boolean;
  user?: User;
}

export interface Call {
  id: string;
  callerId: string;
  callType: CallType;
  status: CallStatus;
  conversationId?: string | null;
  startedAt?: string | Date | null;
  endedAt?: string | Date | null;
  durationSeconds?: number | null;
  createdAt: string | Date;
  caller?: User;
  participants?: CallParticipant[];
}

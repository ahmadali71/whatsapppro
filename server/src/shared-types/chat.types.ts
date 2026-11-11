import { Message } from './message.types';
import { User } from './user.types';

export enum ConversationType {
  DIRECT = 'DIRECT',
  GROUP = 'GROUP',
  COMMUNITY = 'COMMUNITY',
}

export enum MemberRole {
  MEMBER = 'MEMBER',
  ADMIN = 'ADMIN',
  OWNER = 'OWNER',
}

export interface ConversationMember {
  id: string;
  conversationId: string;
  userId: string;
  role: MemberRole;
  joinedAt: string | Date;
  leftAt?: string | Date | null;
  isActive: boolean;
  lastReadMessageId?: string | null;
  unreadCount: number;
  user?: User;
}

export interface Conversation {
  id: string;
  type: ConversationType;
  createdBy: string;
  groupId?: string | null;
  isArchived: boolean;
  isMuted: boolean;
  mutedUntil?: string | Date | null;
  wallpaper?: string | null;
  disappearingMessagesTimeout?: number | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  members?: ConversationMember[];
  lastMessage?: Message | null;
}

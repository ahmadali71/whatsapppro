import { MemberRole } from './chat.types';
import { User } from './user.types';

export interface Group {
  id: string;
  name: string;
  description?: string | null;
  avatarUrl?: string | null;
  inviteLink?: string | null;
  inviteLinkEnabled: boolean;
  onlyAdminsCanMessage: boolean;
  onlyAdminsCanEditInfo: boolean;
  createdBy: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  deletedAt?: string | Date | null;
  members?: GroupMember[];
}

export interface GroupMember {
  id: string;
  groupId: string;
  userId: string;
  role: MemberRole;
  joinedAt: string | Date;
  addedBy?: string | null;
  isActive: boolean;
  user?: User;
}

export interface GroupInvite {
  id: string;
  groupId: string;
  inviteCode: string;
  createdBy: string;
  expiresAt?: string | Date | null;
  maxUses?: number | null;
  useCount: number;
  isActive: boolean;
  createdAt: string | Date;
}

export interface Community {
  id: string;
  name: string;
  description?: string | null;
  avatarUrl?: string | null;
  inviteLink?: string | null;
  createdBy: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  deletedAt?: string | Date | null;
}

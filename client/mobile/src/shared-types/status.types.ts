import { PrivacyVisibility, User } from './user.types';

export enum StatusContentType {
  TEXT = 'TEXT',
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO',
}

export interface Status {
  id: string;
  userId: string;
  contentType: StatusContentType;
  contentUrl?: string | null;
  textContent?: string | null;
  caption?: string | null;
  backgroundColor?: string | null;
  fontStyle?: string | null;
  privacy: PrivacyVisibility;
  expiresAt: string | Date;
  createdAt: string | Date;
  user?: User;
  views?: StatusView[];
  reactions?: StatusReaction[];
}

export interface StatusView {
  id: string;
  statusId: string;
  viewerId: string;
  viewedAt: string | Date;
  viewer?: User;
}

export interface StatusReaction {
  id: string;
  statusId: string;
  userId: string;
  emoji: string;
  createdAt: string | Date;
  user?: User;
}

export enum MessageType {
  TEXT = 'TEXT',
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO',
  AUDIO = 'AUDIO',
  DOCUMENT = 'DOCUMENT',
  LOCATION = 'LOCATION',
  CONTACT = 'CONTACT',
  STICKER = 'STICKER',
  GIF = 'GIF',
  VOICE = 'VOICE',
  POLL = 'POLL',
}

export enum ReceiptStatus {
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  READ = 'READ',
}

export interface Attachment {
  id: string;
  messageId: string;
  fileType: string;
  fileUrl: string;
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
  thumbnailUrl?: string | null;
  createdAt: string | Date;
}

export interface Reaction {
  id: string;
  messageId: string;
  userId: string;
  emoji: string;
  createdAt: string | Date;
}

export interface MessageReceipt {
  id: string;
  messageId: string;
  userId: string;
  status: ReceiptStatus;
  timestamp: string | Date;
}

export interface MessageEdit {
  id: string;
  messageId: string;
  oldContent: string;
  newContent: string;
  editedAt: string | Date;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  content?: string | null;
  messageType: MessageType;
  replyToId?: string | null;
  isEdited: boolean;
  isDeletedForEveryone: boolean;
  forwardedFromId?: string | null;
  isViewOnce: boolean;
  isStarred: boolean;
  isEncrypted: boolean;
  encryptionMetadata?: Record<string, unknown> | null;
  sentAt: string | Date;
  deliveredAt?: string | Date | null;
  readAt?: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  attachments?: Attachment[];
  reactions?: Reaction[];
  receipts?: MessageReceipt[];
  replyTo?: Message | null;
}

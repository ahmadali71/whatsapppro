import {
  Call,
  CallStatus,
  CallType,
  Conversation,
  ConversationMember,
  ConversationType,
  Group,
  MemberRole,
  Message,
  MessageType,
  ReceiptStatus,
  Status,
  User,
} from '@whatsapp-pro/shared-types';

export type RootStackParamList = {
  Welcome: undefined;
  PhoneRegister: undefined;
  OtpVerify: { phoneNumber: string; countryCode: string };
  TwoFactorPin: { mode: 'verify' | 'setup'; phoneNumber?: string };
  ProfileSetup: { isOnboarding?: boolean };
  MainTabs: undefined;
  ChatRoom: { conversationId: string; title?: string; avatarUrl?: string | null; peerUserId?: string };
  ActiveCall: { callId: string; conversationId?: string; callType: CallType; peerName?: string; peerAvatar?: string | null; isCaller?: boolean };
  GroupInfo: { groupId: string; conversationId: string };
  StatusViewer: { userId: string; initialStatusId?: string };
  AccountSettings: undefined;
  PrivacySettings: undefined;
  ChatSettings: undefined;
  NotificationSettings: undefined;
  StorageSettings: undefined;
  LinkedDevices: undefined;
};

export type MainTabParamList = {
  Chats: undefined;
  Updates: undefined;
  Communities: undefined;
  Calls: undefined;
  Settings: undefined;
};

export interface CountryCodeItem {
  name: string;
  code: string; // ISO alpha-2
  dialCode: string;
  flag: string;
}

export const COUNTRY_CODES: CountryCodeItem[] = [
  { name: 'United States', code: 'US', dialCode: '+1', flag: '🇺🇸' },
  { name: 'United Kingdom', code: 'GB', dialCode: '+44', flag: '🇬🇧' },
  { name: 'India', code: 'IN', dialCode: '+91', flag: '🇮🇳' },
  { name: 'Canada', code: 'CA', dialCode: '+1', flag: '🇨🇦' },
  { name: 'Germany', code: 'DE', dialCode: '+49', flag: '🇩🇪' },
  { name: 'France', code: 'FR', dialCode: '+33', flag: '🇫🇷' },
  { name: 'Brazil', code: 'BR', dialCode: '+55', flag: '🇧🇷' },
  { name: 'Australia', code: 'AU', dialCode: '+61', flag: '🇦🇺' },
  { name: 'Japan', code: 'JP', dialCode: '+81', flag: '🇯🇵' },
  { name: 'South Korea', code: 'KR', dialCode: '+82', flag: '🇰🇷' },
  { name: 'United Arab Emirates', code: 'AE', dialCode: '+971', flag: '🇦🇪' },
  { name: 'Singapore', code: 'SG', dialCode: '+65', flag: '🇸🇬' },
  { name: 'Nigeria', code: 'NG', dialCode: '+234', flag: '🇳🇬' },
  { name: 'South Africa', code: 'ZA', dialCode: '+27', flag: '🇿🇦' },
  { name: 'Mexico', code: 'MX', dialCode: '+52', flag: '🇲🇽' },
  { name: 'Spain', code: 'ES', dialCode: '+34', flag: '🇪🇸' },
  { name: 'Italy', code: 'IT', dialCode: '+39', flag: '🇮🇹' },
  { name: 'Netherlands', code: 'NL', dialCode: '+31', flag: '🇳🇱' },
  { name: 'Indonesia', code: 'ID', dialCode: '+62', flag: '🇮🇩' },
  { name: 'Pakistan', code: 'PK', dialCode: '+92', flag: '🇵🇰' },
];

export interface MobileConversation extends Omit<Conversation, 'lastMessage'> {
  title?: string;
  avatarUrl?: string | null;
  unreadCount: number;
  isPinned?: boolean;
  group?: Group | null;
  peerUser?: User | null;
  lastMessage?: MobileMessage | null;
}

export interface MobileMessage extends Omit<Message, 'replyTo'> {
  localStatus?: 'SENDING' | 'FAILED' | 'SENT';
  sender?: Partial<User> | null;
  decryptedContent?: string | null;
  replyTo?: MobileMessage | null;
}

export interface StatusGroup {
  userId: string;
  user: User;
  statuses: Status[];
  hasUnviewed: boolean;
  latestAt: string;
}

export interface IncomingCallPayload {
  callId: string;
  callerId: string;
  callerName: string;
  callerAvatar?: string | null;
  conversationId?: string | null;
  callType: CallType;
}

/**
 * Unwraps standard `{ success, data, message }` responses or returns raw payload.
 */
export function unwrapApiData<T = unknown>(payload: unknown): T {
  if (payload && typeof payload === 'object' && 'data' in payload && 'success' in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

/**
 * Extracts a human-readable error message from Axios or generic errors.
 */
export function extractErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (!err) return fallback;
  if (typeof err === 'string') return err;
  const anyErr = err as {
    response?: { status?: number; data?: { message?: string | string[]; error?: string } };
    config?: { baseURL?: string; url?: string };
    message?: string;
  };
  const msg = anyErr?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join(', ');
  if (typeof msg === 'string' && msg.trim().length > 0) return msg;
  if (typeof anyErr?.response?.data?.error === 'string') return anyErr.response.data.error;
  if (!anyErr?.response && anyErr?.message === 'Network Error') {
    const target = anyErr?.config?.baseURL || 'server';
    return `Cannot reach ${target}. Verify the backend is running on port 3001.`;
  }
  if (typeof anyErr?.message === 'string' && anyErr.message.trim().length > 0) return anyErr.message;
  return fallback;
}

/**
 * Normalizes backend user objects (supports camelCase or snake_case Prisma fields).
 */
export function normalizeUser(raw: Record<string, unknown> | null | undefined): User {
  const r = raw ?? {};
  return {
    id: String(r.id ?? ''),
    phoneNumber: String(r.phoneNumber ?? r.phone_number ?? ''),
    countryCode: String(r.countryCode ?? r.country_code ?? 'US'),
    username: (r.username as string | null) ?? null,
    displayName: String(r.displayName ?? r.display_name ?? r.phoneNumber ?? r.phone_number ?? 'User'),
    about: (r.about as string | null) ?? null,
    avatarUrl: (r.avatarUrl ?? r.avatar_url ?? null) as string | null,
    role: (r.role as User['role']) ?? ('USER' as User['role']),
    isVerified: Boolean(r.isVerified ?? r.is_verified ?? false),
    isActive: Boolean(r.isActive ?? r.is_active ?? true),
    isBanned: Boolean(r.isBanned ?? r.is_banned ?? false),
    twoFactorEnabled: Boolean(r.twoFactorEnabled ?? r.two_factor_enabled ?? false),
    recoveryEmail: (r.recoveryEmail ?? r.recovery_email ?? null) as string | null,
    createdAt: (r.createdAt ?? r.created_at ?? new Date().toISOString()) as string,
    updatedAt: (r.updatedAt ?? r.updated_at ?? new Date().toISOString()) as string,
    deletedAt: (r.deletedAt ?? r.deleted_at ?? null) as string | null,
  };
}

/**
 * Normalizes a message object from REST or Socket.IO into MobileMessage.
 */
export function normalizeMessage(raw: Record<string, unknown>): MobileMessage {
  const senderRaw = (raw.sender ?? raw.users ?? null) as Record<string, unknown> | null;
  const attachmentsRaw = (raw.attachments ?? raw.message_attachments ?? []) as Record<string, unknown>[];
  const reactionsRaw = (raw.reactions ?? raw.message_reactions ?? []) as Record<string, unknown>[];
  const receiptsRaw = (raw.receipts ?? raw.message_receipts ?? []) as Record<string, unknown>[];
  const replyRaw = (raw.replyTo ?? raw.reply_to ?? null) as Record<string, unknown> | null;

  return {
    id: String(raw.id ?? ''),
    conversationId: String(raw.conversationId ?? raw.conversation_id ?? ''),
    senderId: String(raw.senderId ?? raw.sender_id ?? senderRaw?.id ?? ''),
    content: (raw.content ?? null) as string | null,
    messageType: (raw.messageType ?? raw.message_type ?? MessageType.TEXT) as MessageType,
    replyToId: (raw.replyToId ?? raw.reply_to_id ?? null) as string | null,
    isEdited: Boolean(raw.isEdited ?? raw.is_edited ?? false),
    isDeletedForEveryone: Boolean(raw.isDeletedForEveryone ?? raw.is_deleted_for_everyone ?? false),
    forwardedFromId: (raw.forwardedFromId ?? raw.forwarded_from_id ?? null) as string | null,
    isViewOnce: Boolean(raw.isViewOnce ?? raw.is_view_once ?? false),
    isStarred: Boolean(raw.isStarred ?? raw.is_starred ?? false),
    isEncrypted: Boolean(raw.isEncrypted ?? raw.is_encrypted ?? false),
    encryptionMetadata: (raw.encryptionMetadata ?? raw.encryption_metadata ?? null) as Record<string, unknown> | null,
    sentAt: (raw.sentAt ?? raw.sent_at ?? raw.createdAt ?? raw.created_at ?? new Date().toISOString()) as string,
    deliveredAt: (raw.deliveredAt ?? raw.delivered_at ?? null) as string | null,
    readAt: (raw.readAt ?? raw.read_at ?? null) as string | null,
    createdAt: (raw.createdAt ?? raw.created_at ?? new Date().toISOString()) as string,
    updatedAt: (raw.updatedAt ?? raw.updated_at ?? new Date().toISOString()) as string,
    sender: senderRaw ? normalizeUser(senderRaw) : null,
    attachments: attachmentsRaw.map((a) => ({
      id: String(a.id ?? ''),
      messageId: String(a.messageId ?? a.message_id ?? raw.id ?? ''),
      fileType: String(a.fileType ?? a.file_type ?? 'FILE'),
      fileUrl: String(a.fileUrl ?? a.file_url ?? ''),
      fileName: (a.fileName ?? a.file_name ?? null) as string | null,
      fileSize: (a.fileSize ?? a.file_size ?? null) as number | null,
      mimeType: (a.mimeType ?? a.mime_type ?? null) as string | null,
      duration: (a.duration ?? null) as number | null,
      width: (a.width ?? null) as number | null,
      height: (a.height ?? null) as number | null,
      thumbnailUrl: (a.thumbnailUrl ?? a.thumbnail_url ?? null) as string | null,
      createdAt: (a.createdAt ?? a.created_at ?? new Date().toISOString()) as string,
    })),
    reactions: reactionsRaw.map((rx) => ({
      id: String(rx.id ?? `${rx.messageId ?? rx.message_id}_${rx.userId ?? rx.user_id}_${rx.emoji}`),
      messageId: String(rx.messageId ?? rx.message_id ?? raw.id ?? ''),
      userId: String(rx.userId ?? rx.user_id ?? ''),
      emoji: String(rx.emoji ?? ''),
      createdAt: (rx.createdAt ?? rx.created_at ?? new Date().toISOString()) as string,
    })),
    receipts: receiptsRaw.map((rc) => ({
      id: String(rc.id ?? ''),
      messageId: String(rc.messageId ?? rc.message_id ?? raw.id ?? ''),
      userId: String(rc.userId ?? rc.user_id ?? ''),
      status: (rc.status ?? ReceiptStatus.SENT) as ReceiptStatus,
      timestamp: (rc.timestamp ?? new Date().toISOString()) as string,
    })),
    replyTo: replyRaw ? normalizeMessage(replyRaw) : null,
  };
}

/**
 * Normalizes a conversation payload into MobileConversation with derived title/avatar/peerUser.
 */
export function normalizeConversation(
  raw: Record<string, unknown>,
  currentUserId?: string,
): MobileConversation {
  const membersRaw = (raw.members ?? raw.conversation_members ?? []) as Record<string, unknown>[];
  const members: ConversationMember[] = membersRaw.map((m) => {
    const userRaw = (m.user ?? m.users ?? null) as Record<string, unknown> | null;
    return {
      id: String(m.id ?? ''),
      conversationId: String(m.conversationId ?? m.conversation_id ?? raw.id ?? ''),
      userId: String(m.userId ?? m.user_id ?? userRaw?.id ?? ''),
      role: (m.role ?? MemberRole.MEMBER) as MemberRole,
      joinedAt: (m.joinedAt ?? m.joined_at ?? new Date().toISOString()) as string,
      leftAt: (m.leftAt ?? m.left_at ?? null) as string | null,
      isActive: Boolean(m.isActive ?? m.is_active ?? true),
      lastReadMessageId: (m.lastReadMessageId ?? m.last_read_message_id ?? null) as string | null,
      unreadCount: Number(m.unreadCount ?? m.unread_count ?? 0),
      user: userRaw ? normalizeUser(userRaw) : undefined,
    };
  });

  const membershipRaw = (raw.membership ?? null) as Record<string, unknown> | null;
  const selfMember = members.find((m) => m.userId === currentUserId);
  const peerMember = members.find((m) => m.userId !== currentUserId) ?? members[0];
  const groupRaw = (raw.group ?? raw.groups ?? null) as Record<string, unknown> | null;
  const group: Group | null = groupRaw
    ? {
        id: String(groupRaw.id ?? ''),
        name: String(groupRaw.name ?? 'Group'),
        description: (groupRaw.description ?? null) as string | null,
        avatarUrl: (groupRaw.avatarUrl ?? groupRaw.avatar_url ?? null) as string | null,
        inviteLink: (groupRaw.inviteLink ?? groupRaw.invite_link ?? null) as string | null,
        inviteLinkEnabled: Boolean(groupRaw.inviteLinkEnabled ?? groupRaw.invite_link_enabled ?? true),
        onlyAdminsCanMessage: Boolean(groupRaw.onlyAdminsCanMessage ?? groupRaw.only_admins_can_message ?? false),
        onlyAdminsCanEditInfo: Boolean(groupRaw.onlyAdminsCanEditInfo ?? groupRaw.only_admins_can_edit_info ?? false),
        createdBy: String(groupRaw.createdBy ?? groupRaw.created_by ?? ''),
        createdAt: (groupRaw.createdAt ?? groupRaw.created_at ?? new Date().toISOString()) as string,
        updatedAt: (groupRaw.updatedAt ?? groupRaw.updated_at ?? new Date().toISOString()) as string,
      }
    : null;

  const type = (raw.type ?? ConversationType.DIRECT) as ConversationType;
  const lastMsgRaw = (raw.lastMessage ?? (Array.isArray(raw.messages) ? raw.messages[0] : null)) as
    | Record<string, unknown>
    | null;

  const title =
    type === ConversationType.DIRECT
      ? peerMember?.user?.displayName || peerMember?.user?.phoneNumber || 'Direct Chat'
      : group?.name || (raw.title as string) || 'Group Chat';

  const avatarUrl =
    type === ConversationType.DIRECT
      ? peerMember?.user?.avatarUrl ?? null
      : group?.avatarUrl ?? null;

  return {
    id: String(raw.id ?? ''),
    type,
    createdBy: String(raw.createdBy ?? raw.created_by ?? ''),
    groupId: (raw.groupId ?? raw.group_id ?? group?.id ?? null) as string | null,
    isArchived: Boolean(raw.isArchived ?? raw.is_archived ?? false),
    isMuted: Boolean(raw.isMuted ?? raw.is_muted ?? false),
    mutedUntil: (raw.mutedUntil ?? raw.muted_until ?? null) as string | null,
    wallpaper: (raw.wallpaper ?? null) as string | null,
    disappearingMessagesTimeout: (raw.disappearingMessagesTimeout ??
      raw.disappearing_messages_timeout ??
      null) as number | null,
    createdAt: (raw.createdAt ?? raw.created_at ?? new Date().toISOString()) as string,
    updatedAt: (raw.updatedAt ?? raw.updated_at ?? new Date().toISOString()) as string,
    members,
    lastMessage: lastMsgRaw ? normalizeMessage(lastMsgRaw) : null,
    title,
    avatarUrl,
    unreadCount: Number(membershipRaw?.unreadCount ?? selfMember?.unreadCount ?? raw.unreadCount ?? 0),
    group,
    peerUser: peerMember?.user ?? null,
  };
}

export function normalizeCall(raw: Record<string, unknown>): Call {
  const callerRaw = (raw.caller ?? raw.users ?? null) as Record<string, unknown> | null;
  const participantsRaw = (raw.participants ?? raw.call_participants ?? []) as Record<string, unknown>[];
  return {
    id: String(raw.id ?? ''),
    callerId: String(raw.callerId ?? raw.caller_id ?? ''),
    callType: (raw.callType ?? raw.call_type ?? CallType.AUDIO) as CallType,
    status: (raw.status ?? CallStatus.INITIATED) as CallStatus,
    conversationId: (raw.conversationId ?? raw.conversation_id ?? null) as string | null,
    startedAt: (raw.startedAt ?? raw.started_at ?? null) as string | null,
    endedAt: (raw.endedAt ?? raw.ended_at ?? null) as string | null,
    durationSeconds: (raw.durationSeconds ?? raw.duration_seconds ?? null) as number | null,
    createdAt: (raw.createdAt ?? raw.created_at ?? new Date().toISOString()) as string,
    caller: callerRaw ? normalizeUser(callerRaw) : undefined,
    participants: participantsRaw.map((p) => {
      const u = (p.user ?? p.users ?? null) as Record<string, unknown> | null;
      return {
        id: String(p.id ?? ''),
        callId: String(p.callId ?? p.call_id ?? raw.id ?? ''),
        userId: String(p.userId ?? p.user_id ?? ''),
        joinedAt: (p.joinedAt ?? p.joined_at ?? null) as string | null,
        leftAt: (p.leftAt ?? p.left_at ?? null) as string | null,
        isMuted: Boolean(p.isMuted ?? p.is_muted ?? false),
        isVideoOn: Boolean(p.isVideoOn ?? p.is_video_on ?? false),
        user: u ? normalizeUser(u) : undefined,
      };
    }),
  };
}

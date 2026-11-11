import { create } from 'zustand';
import {
  Contact,
  Conversation,
  ConversationType,
  Group,
  Message,
  MessageType,
  ReceiptStatus,
  SocketEvents,
  User,
} from '@whatsapp-pro/shared-types';
import { api, extractErrorMessage, unwrapData } from '@/lib/api';
import { socketManager } from '@/lib/socket';
import { e2eeManager } from '@/lib/e2ee';
import { mediaApi } from '@/services/api.services';
import { useAuthStore } from './authStore';

export interface ConversationWithMeta extends Omit<Conversation, 'lastMessage'> {
  group?: Group | null;
  unreadCount?: number;
  isPinned?: boolean;
  lastMessage?: LocalMessage | null;
}

export interface LocalMessage extends Message {
  decryptedContent?: string;
  sender?: User;
  clientStatus?: 'sending' | 'sent' | 'failed';
  uploadProgress?: number;
  isPinned?: boolean;
}

export interface SearchResults {
  contacts: User[];
  messages: LocalMessage[];
  groups: Group[];
  media: LocalMessage[];
}

interface PendingAttachmentPayload {
  file: File | Blob;
  fileName?: string;
  messageType: MessageType;
  caption?: string;
  isViewOnce?: boolean;
  duration?: number;
}

interface ChatState {
  conversations: ConversationWithMeta[];
  activeConversationId: string | null;
  messagesByConv: Record<string, LocalMessage[]>;
  hasMoreByConv: Record<string, boolean>;
  nextCursorByConv: Record<string, string | null>;
  typingByConv: Record<string, Record<string, boolean>>;
  onlineUsers: Record<string, { isOnline: boolean; lastSeen?: string }>;
  contacts: Contact[];
  blockedUsers: User[];
  starredMessages: LocalMessage[];
  pinnedMessageIds: Record<string, string[]>;
  pinnedConversationIds: string[];
  replyingTo: LocalMessage | null;
  editingMessage: LocalMessage | null;
  isLoadingConversations: boolean;
  isLoadingMessages: boolean;
  socketInitialized: boolean;

  setActiveConversation: (conversationId: string | null) => void;
  setReplyingTo: (message: LocalMessage | null) => void;
  setEditingMessage: (message: LocalMessage | null) => void;
  togglePinConversation: (conversationId: string) => void;
  togglePinMessage: (conversationId: string, messageId: string) => void;

  fetchConversations: () => Promise<void>;
  fetchMessages: (conversationId: string, loadMore?: boolean) => Promise<void>;
  createDirectChat: (otherUserId: string) => Promise<ConversationWithMeta>;
  sendMessage: (
    conversationId: string,
    payload: {
      messageType: MessageType;
      content?: string;
      replyToId?: string;
      isViewOnce?: boolean;
      attachmentUrl?: string;
      attachmentName?: string;
      attachmentSize?: number;
      mimeType?: string;
      duration?: number;
      latitude?: number;
      longitude?: number;
      contactName?: string;
      contactPhone?: string;
      encryptE2EE?: boolean;
    },
  ) => Promise<LocalMessage>;
  sendMediaMessage: (conversationId: string, attachment: PendingAttachmentPayload) => Promise<void>;
  retryMessage: (conversationId: string, tempId: string) => Promise<void>;
  editMessage: (messageId: string, conversationId: string, newContent: string) => Promise<void>;
  votePoll: (messageId: string, conversationId: string, optionId: string) => Promise<void>;
  deleteMessage: (messageId: string, conversationId: string, deleteForEveryone: boolean) => Promise<void>;
  toggleReaction: (messageId: string, conversationId: string, emoji: string) => Promise<void>;
  toggleStar: (messageId: string, conversationId: string, currentlyStarred: boolean) => Promise<void>;
  forwardMessage: (messageId: string, targetConversationIds: string[]) => Promise<void>;
  archiveConversation: (conversationId: string, archive: boolean) => Promise<void>;
  muteConversation: (conversationId: string, muted: boolean, mutedUntil?: string | null) => Promise<void>;
  markConversationRead: (conversationId: string) => void;

  fetchContacts: () => Promise<void>;
  addContact: (phoneNumber: string, nickname?: string) => Promise<Contact>;
  removeContact: (contactId: string) => Promise<void>;
  syncContacts: (phones: string[]) => Promise<Contact[]>;
  searchUsers: (query: string, type?: 'phone' | 'username') => Promise<User[]>;
  fetchBlockedUsers: () => Promise<void>;
  blockUser: (userId: string) => Promise<void>;
  unblockUser: (userId: string) => Promise<void>;
  fetchStarredMessages: () => Promise<void>;
  globalSearch: (params: {
    q: string;
    type?: 'all' | 'contacts' | 'messages' | 'groups' | 'media';
    dateFrom?: string;
    dateTo?: string;
    conversationId?: string;
  }) => Promise<SearchResults>;

  initSocketListeners: () => () => void;
}

const PINNED_CONV_KEY = 'wp_pinned_convs';
const PINNED_MSG_KEY = 'wp_pinned_msgs';

function loadPinnedConvs(): string[] {
  try {
    return JSON.parse(localStorage.getItem(PINNED_CONV_KEY) || '[]') as string[];
  } catch {
    return [];
  }
}

function loadPinnedMsgs(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(PINNED_MSG_KEY) || '{}') as Record<string, string[]>;
  } catch {
    return {};
  }
}

async function maybeDecryptMessage(msg: Message): Promise<LocalMessage> {
  const currentUserId = useAuthStore.getState().user?.id;
  if (msg.isEncrypted && msg.content && msg.senderId !== currentUserId) {
    const decryptedContent = await e2eeManager.decryptMessage(msg.senderId, msg.content);
    return { ...msg, decryptedContent };
  }
  // If sender is current user and content is our own encrypted envelope, check local cache or show plaintext if stored
  if (msg.isEncrypted && msg.content) {
    const cachedPlain = sessionStorage.getItem(`e2ee_plain_${msg.id}`);
    if (cachedPlain) {
      return { ...msg, decryptedContent: cachedPlain };
    }
  }
  return { ...msg, decryptedContent: msg.content || undefined };
}

function isMatchingOptimistic(
  optimistic: LocalMessage,
  incoming: LocalMessage,
  currentUserId?: string,
): boolean {
  if (!optimistic.id.startsWith('temp-')) return false;
  if (!currentUserId || optimistic.senderId !== currentUserId) return false;
  if (incoming.senderId !== currentUserId) return false;
  if (optimistic.messageType !== incoming.messageType) return false;

  const optPlain = optimistic.decryptedContent ?? optimistic.content ?? '';
  const incPlain = incoming.decryptedContent ?? incoming.content ?? '';
  if (optPlain && incPlain && optPlain === incPlain) return true;

  const optAttUrl = optimistic.attachments?.[0]?.fileUrl;
  const incAttUrl = incoming.attachments?.[0]?.fileUrl;
  if (optAttUrl && incAttUrl && optAttUrl === incAttUrl) return true;

  return optimistic.clientStatus === 'sending';
}

function upsertMessage(
  list: LocalMessage[],
  incoming: LocalMessage,
  currentUserId?: string,
): LocalMessage[] {
  const existingIdx = list.findIndex((m) => m.id === incoming.id);
  let next: LocalMessage[];

  if (existingIdx !== -1) {
    next = list
      .filter((m) => !(m.id.startsWith('temp-') && isMatchingOptimistic(m, incoming, currentUserId)))
      .map((m) =>
        m.id === incoming.id
          ? {
              ...m,
              ...incoming,
              decryptedContent: incoming.decryptedContent ?? m.decryptedContent,
              clientStatus: 'sent' as const,
            }
          : m,
      );
  } else {
    const optIdx = list.findIndex((m) => isMatchingOptimistic(m, incoming, currentUserId));
    if (optIdx !== -1) {
      next = list.map((m, idx) =>
        idx === optIdx
          ? {
              ...incoming,
              decryptedContent: incoming.decryptedContent ?? m.decryptedContent,
              clientStatus: 'sent' as const,
            }
          : m,
      );
    } else {
      next = [...list, incoming];
    }
  }

  return next.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  messagesByConv: {},
  hasMoreByConv: {},
  nextCursorByConv: {},
  typingByConv: {},
  onlineUsers: {},
  contacts: [],
  blockedUsers: [],
  starredMessages: [],
  pinnedMessageIds: loadPinnedMsgs(),
  pinnedConversationIds: loadPinnedConvs(),
  replyingTo: null,
  editingMessage: null,
  isLoadingConversations: false,
  isLoadingMessages: false,
  socketInitialized: false,

  setActiveConversation: (conversationId) => {
    const prev = get().activeConversationId;
    if (prev && prev !== conversationId) {
      socketManager.leaveConversation(prev);
    }
    set({ activeConversationId: conversationId, replyingTo: null, editingMessage: null });
    if (conversationId) {
      socketManager.joinConversation(conversationId);
      get().markConversationRead(conversationId);
      if (!get().messagesByConv[conversationId]) {
        void get().fetchMessages(conversationId);
      }
    }
  },

  setReplyingTo: (message) => set({ replyingTo: message, editingMessage: null }),
  setEditingMessage: (message) => set({ editingMessage: message, replyingTo: null }),

  togglePinConversation: (conversationId) => {
    const current = get().pinnedConversationIds;
    const next = current.includes(conversationId)
      ? current.filter((id) => id !== conversationId)
      : [...current, conversationId];
    localStorage.setItem(PINNED_CONV_KEY, JSON.stringify(next));
    set({ pinnedConversationIds: next });
  },

  togglePinMessage: (conversationId, messageId) => {
    const all = { ...get().pinnedMessageIds };
    const list = all[conversationId] || [];
    const willPin = !list.includes(messageId);
    all[conversationId] = willPin
      ? [...list, messageId]
      : list.filter((id) => id !== messageId);
    localStorage.setItem(PINNED_MSG_KEY, JSON.stringify(all));
    set({ pinnedMessageIds: all });
    if (willPin) {
      void api.post(`/messages/${messageId}/pin`).catch(() => {});
    } else {
      void api.delete(`/messages/${messageId}/pin`).catch(() => {});
    }
  },

  fetchConversations: async () => {
    set({ isLoadingConversations: true });
    try {
      const res = await api.get('/chats');
      const raw = unwrapData<ConversationWithMeta[] | { items?: ConversationWithMeta[]; conversations?: ConversationWithMeta[] }>(
        res.data,
      );
      const list = Array.isArray(raw) ? raw : raw?.items || raw?.conversations || [];

      const onlineMap = { ...get().onlineUsers };
      const decryptedList = await Promise.all(
        list.map(async (conv) => {
          socketManager.joinConversation(conv.id);
          conv.members?.forEach((m) => {
            socketManager.emit(SocketEvents.PRESENCE_SUBSCRIBE, { userId: m.userId }, false);
            if (m.user && !(m.userId in onlineMap)) {
              onlineMap[m.userId] = { isOnline: false };
            }
          });
          if (conv.lastMessage) {
            const dec = await maybeDecryptMessage(conv.lastMessage);
            return { ...conv, lastMessage: dec };
          }
          return conv;
        }),
      );

      set({
        conversations: decryptedList,
        onlineUsers: onlineMap,
        isLoadingConversations: false,
      });
    } catch {
      set({ isLoadingConversations: false });
    }
  },

  fetchMessages: async (conversationId, loadMore = false) => {
    const cursor = loadMore ? get().nextCursorByConv[conversationId] : undefined;
    if (loadMore && !cursor) return;

    set({ isLoadingMessages: true });
    try {
      const res = await api.get(`/chats/${conversationId}/messages`, {
        params: { cursor: cursor || undefined, limit: 40 },
      });
      const raw = unwrapData<
        Message[] | { items?: Message[]; messages?: Message[]; nextCursor?: string | null; hasMore?: boolean }
      >(res.data);

      const items = Array.isArray(raw) ? raw : raw?.items || raw?.messages || [];
      const nextCursor = Array.isArray(raw) ? null : raw?.nextCursor ?? null;
      const hasMore = Array.isArray(raw) ? items.length >= 40 : Boolean(raw?.hasMore ?? nextCursor);

      const decrypted = await Promise.all(items.map(maybeDecryptMessage));
      const existing = loadMore ? get().messagesByConv[conversationId] || [] : [];

      // Merge & sort chronologically
      const mergedMap = new Map<string, LocalMessage>();
      [...decrypted, ...existing].forEach((m) => mergedMap.set(m.id, m));
      const sorted = Array.from(mergedMap.values()).sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );

      set((state) => ({
        messagesByConv: { ...state.messagesByConv, [conversationId]: sorted },
        nextCursorByConv: { ...state.nextCursorByConv, [conversationId]: nextCursor },
        hasMoreByConv: { ...state.hasMoreByConv, [conversationId]: hasMore },
        isLoadingMessages: false,
      }));
    } catch {
      set({ isLoadingMessages: false });
    }
  },

  createDirectChat: async (otherUserId) => {
    const res = await api.post('/chats', { otherUserId });
    const conv = unwrapData<ConversationWithMeta>(res.data);
    socketManager.joinConversation(conv.id);
    set((state) => {
      const exists = state.conversations.some((c) => c.id === conv.id);
      return {
        conversations: exists ? state.conversations : [conv, ...state.conversations],
      };
    });
    return conv;
  },

  sendMessage: async (conversationId, payload) => {
    const currentUser = useAuthStore.getState().user;
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    let wireContent = payload.content;
    let isEncrypted = false;
    let encryptionMetadata: Record<string, unknown> | undefined;

    // Client-side Signal E2EE encryption for 1:1 text messages when enabled
    const conv = get().conversations.find((c) => c.id === conversationId);
    const shouldEncrypt =
      payload.encryptE2EE !== false &&
      conv?.type === ConversationType.DIRECT &&
      payload.messageType === MessageType.TEXT &&
      Boolean(payload.content);

    if (shouldEncrypt && conv?.members && payload.content) {
      const recipient = conv.members.find((m) => m.userId !== currentUser?.id);
      if (recipient) {
        const encrypted = await e2eeManager.encryptMessage(recipient.userId, payload.content);
        if (encrypted) {
          wireContent = encrypted.ciphertext;
          isEncrypted = true;
          encryptionMetadata = encrypted.metadata;
        }
      }
    }

    const optimistic: LocalMessage = {
      id: tempId,
      conversationId,
      senderId: currentUser?.id || '',
      sender: currentUser || undefined,
      content: wireContent || null,
      decryptedContent: payload.content,
      messageType: payload.messageType,
      replyToId: payload.replyToId || null,
      isEdited: false,
      isDeletedForEveryone: false,
      isViewOnce: Boolean(payload.isViewOnce),
      isStarred: false,
      isEncrypted,
      encryptionMetadata: encryptionMetadata || null,
      sentAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      clientStatus: 'sending',
      attachments: payload.attachmentUrl
        ? [
            {
              id: `att-${tempId}`,
              messageId: tempId,
              fileType: payload.messageType,
              fileUrl: payload.attachmentUrl,
              fileName: payload.attachmentName || null,
              fileSize: payload.attachmentSize || null,
              mimeType: payload.mimeType || null,
              duration: payload.duration || null,
              createdAt: new Date().toISOString(),
            },
          ]
        : [],
    };

    set((state) => ({
      messagesByConv: {
        ...state.messagesByConv,
        [conversationId]: [...(state.messagesByConv[conversationId] || []), optimistic],
      },
      replyingTo: null,
    }));

    try {
      const res = await api.post(`/chats/${conversationId}/messages`, {
        messageType: payload.messageType,
        content: wireContent,
        replyToId: payload.replyToId,
        isViewOnce: payload.isViewOnce,
        attachmentUrl: payload.attachmentUrl,
        attachmentName: payload.attachmentName,
        attachmentSize: payload.attachmentSize,
        mimeType: payload.mimeType,
        latitude: payload.latitude,
        longitude: payload.longitude,
        contactName: payload.contactName,
        contactPhone: payload.contactPhone,
        isEncrypted,
        encryptionMetadata,
      });

      const saved = unwrapData<Message>(res.data);
      if (isEncrypted && payload.content) {
        sessionStorage.setItem(`e2ee_plain_${saved.id}`, payload.content);
      }
      const normalized: LocalMessage = {
        ...saved,
        decryptedContent: payload.content ?? saved.content ?? undefined,
        clientStatus: 'sent',
      };

      set((state) => {
        const list = (state.messagesByConv[conversationId] || []).filter(
          (m) => m.id !== tempId || !state.messagesByConv[conversationId]?.some((x) => x.id === normalized.id),
        );
        const replaced = list.some((m) => m.id === tempId)
          ? list.map((m) => (m.id === tempId ? normalized : m))
          : upsertMessage(list, normalized, currentUser?.id);
        return {
          messagesByConv: {
            ...state.messagesByConv,
            [conversationId]: replaced,
          },
          conversations: state.conversations
            .map((c) =>
              c.id === conversationId
                ? { ...c, lastMessage: normalized, updatedAt: normalized.createdAt }
                : c,
            )
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
        };
      });

      return normalized;
    } catch (err) {
      set((state) => ({
        messagesByConv: {
          ...state.messagesByConv,
          [conversationId]: (state.messagesByConv[conversationId] || []).map((m) =>
            m.id === tempId ? { ...m, clientStatus: 'failed' } : m,
          ),
        },
      }));
      throw new Error(extractErrorMessage(err, 'Failed to send message'));
    }
  },

  sendMediaMessage: async (conversationId, attachment) => {
    const currentUser = useAuthStore.getState().user;
    const tempId = `temp-media-${Date.now()}`;
    const previewUrl = URL.createObjectURL(attachment.file);

    const optimistic: LocalMessage = {
      id: tempId,
      conversationId,
      senderId: currentUser?.id || '',
      sender: currentUser || undefined,
      content: attachment.caption || null,
      decryptedContent: attachment.caption,
      messageType: attachment.messageType,
      isEdited: false,
      isDeletedForEveryone: false,
      isViewOnce: Boolean(attachment.isViewOnce),
      isStarred: false,
      isEncrypted: false,
      sentAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      clientStatus: 'sending',
      uploadProgress: 0,
      attachments: [
        {
          id: `att-${tempId}`,
          messageId: tempId,
          fileType: attachment.messageType,
          fileUrl: previewUrl,
          fileName: attachment.fileName || (attachment.file instanceof File ? attachment.file.name : 'media'),
          fileSize: attachment.file.size,
          mimeType: attachment.file.type || null,
          duration: attachment.duration || null,
          createdAt: new Date().toISOString(),
        },
      ],
    };

    set((state) => ({
      messagesByConv: {
        ...state.messagesByConv,
        [conversationId]: [...(state.messagesByConv[conversationId] || []), optimistic],
      },
    }));

    try {
      const uploaded = await mediaApi.uploadFile(
        attachment.file,
        'chat-media',
        (pct) => {
          set((state) => ({
            messagesByConv: {
              ...state.messagesByConv,
              [conversationId]: (state.messagesByConv[conversationId] || []).map((m) =>
                m.id === tempId ? { ...m, uploadProgress: pct } : m,
              ),
            },
          }));
        },
        attachment.fileName,
      );

      const res = await api.post(`/chats/${conversationId}/messages`, {
        messageType: attachment.messageType,
        content: attachment.caption || undefined,
        isViewOnce: attachment.isViewOnce,
        attachmentUrl: uploaded.url,
        attachmentName: uploaded.fileName || attachment.fileName,
        attachmentSize: uploaded.fileSize || attachment.file.size,
        mimeType: uploaded.mimeType || attachment.file.type,
      });

      const saved = unwrapData<Message>(res.data);
      const normalized: LocalMessage = {
        ...saved,
        decryptedContent: saved.content || attachment.caption,
        clientStatus: 'sent',
        uploadProgress: 100,
      };

      set((state) => {
        const list = (state.messagesByConv[conversationId] || []).filter(
          (m) => m.id !== tempId || !state.messagesByConv[conversationId]?.some((x) => x.id === normalized.id),
        );
        const replaced = list.some((m) => m.id === tempId)
          ? list.map((m) => (m.id === tempId ? normalized : m))
          : upsertMessage(list, normalized, currentUser?.id);
        return {
          messagesByConv: {
            ...state.messagesByConv,
            [conversationId]: replaced,
          },
          conversations: state.conversations.map((c) =>
            c.id === conversationId ? { ...c, lastMessage: normalized, updatedAt: normalized.createdAt } : c,
          ),
        };
      });
    } catch {
      set((state) => ({
        messagesByConv: {
          ...state.messagesByConv,
          [conversationId]: (state.messagesByConv[conversationId] || []).map((m) =>
            m.id === tempId ? { ...m, clientStatus: 'failed' } : m,
          ),
        },
      }));
    }
  },

  retryMessage: async (conversationId, tempId) => {
    const msg = (get().messagesByConv[conversationId] || []).find((m) => m.id === tempId);
    if (!msg) return;
    // Remove failed message and re-send
    set((state) => ({
      messagesByConv: {
        ...state.messagesByConv,
        [conversationId]: (state.messagesByConv[conversationId] || []).filter((m) => m.id !== tempId),
      },
    }));
    await get().sendMessage(conversationId, {
      messageType: msg.messageType,
      content: msg.decryptedContent || msg.content || undefined,
      replyToId: msg.replyToId || undefined,
      isViewOnce: msg.isViewOnce,
      attachmentUrl: msg.attachments?.[0]?.fileUrl,
      attachmentName: msg.attachments?.[0]?.fileName || undefined,
      attachmentSize: msg.attachments?.[0]?.fileSize || undefined,
      mimeType: msg.attachments?.[0]?.mimeType || undefined,
    });
  },

  editMessage: async (messageId, conversationId, newContent) => {
    const res = await api.patch(`/messages/${messageId}`, { content: newContent });
    const updated = unwrapData<Message>(res.data);
    set((state) => ({
      editingMessage: null,
      messagesByConv: {
        ...state.messagesByConv,
        [conversationId]: (state.messagesByConv[conversationId] || []).map((m) =>
          m.id === messageId
            ? { ...m, ...updated, content: newContent, decryptedContent: newContent, isEdited: true }
            : m,
        ),
      },
    }));
  },

  votePoll: async (messageId, conversationId, optionId) => {
    const optionIndex = Number(optionId.replace('opt-', ''));
    const res = await api.post(`/messages/${messageId}/poll-vote`, {
      optionId,
      optionIndex: Number.isNaN(optionIndex) ? undefined : optionIndex,
    });
    const updated = unwrapData<Message>(res.data);
    if (updated && updated.id) {
      set((state) => ({
        messagesByConv: {
          ...state.messagesByConv,
          [conversationId]: (state.messagesByConv[conversationId] || []).map((m) =>
            m.id === messageId
              ? { ...m, ...updated, decryptedContent: updated.content || m.decryptedContent }
              : m,
          ),
        },
      }));
    }
  },

  deleteMessage: async (messageId, conversationId, deleteForEveryone) => {
    await api.delete(`/messages/${messageId}`, {
      params: { deleteForEveryone },
    });
    set((state) => ({
      messagesByConv: {
        ...state.messagesByConv,
        [conversationId]: deleteForEveryone
          ? (state.messagesByConv[conversationId] || []).map((m) =>
              m.id === messageId
                ? { ...m, isDeletedForEveryone: true, content: null, decryptedContent: undefined }
                : m,
            )
          : (state.messagesByConv[conversationId] || []).filter((m) => m.id !== messageId),
      },
    }));
  },

  toggleReaction: async (messageId, conversationId, emoji) => {
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return;

    await api.post(`/messages/${messageId}/reactions`, { emoji });
    set((state) => ({
      messagesByConv: {
        ...state.messagesByConv,
        [conversationId]: (state.messagesByConv[conversationId] || []).map((m) => {
          if (m.id !== messageId) return m;
          const existing = m.reactions || [];
          const hasSame = existing.some((r) => r.userId === userId && r.emoji === emoji);
          const nextReactions = hasSame
            ? existing.filter((r) => !(r.userId === userId && r.emoji === emoji))
            : [
                ...existing.filter((r) => r.userId !== userId),
                { id: `react-${Date.now()}`, messageId, userId, emoji, createdAt: new Date().toISOString() },
              ];
          return { ...m, reactions: nextReactions };
        }),
      },
    }));
  },

  toggleStar: async (messageId, conversationId, currentlyStarred) => {
    if (currentlyStarred) {
      await api.delete(`/messages/${messageId}/star`);
    } else {
      await api.post(`/messages/${messageId}/star`);
    }
    set((state) => ({
      messagesByConv: {
        ...state.messagesByConv,
        [conversationId]: (state.messagesByConv[conversationId] || []).map((m) =>
          m.id === messageId ? { ...m, isStarred: !currentlyStarred } : m,
        ),
      },
    }));
  },

  forwardMessage: async (messageId, targetConversationIds) => {
    await Promise.all(
      targetConversationIds.map((targetId) =>
        api.post(`/messages/${messageId}/forward`, {
          toConversationId: targetId,
        }),
      ),
    );
    await get().fetchConversations();
  },

  archiveConversation: async (conversationId, archive) => {
    if (archive) {
      await api.post(`/chats/${conversationId}/archive`);
    } else {
      await api.delete(`/chats/${conversationId}/archive`);
    }
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === conversationId ? { ...c, isArchived: archive } : c,
      ),
    }));
  },

  muteConversation: async (conversationId, muted, mutedUntil = null) => {
    await api.patch(`/settings/notifications/${conversationId}`, {
      isMuted: muted,
      mutedUntil,
    });
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === conversationId ? { ...c, isMuted: muted, mutedUntil } : c,
      ),
    }));
  },

  markConversationRead: (conversationId) => {
    const msgs = get().messagesByConv[conversationId] || [];
    const currentUserId = useAuthStore.getState().user?.id;
    const latestOther = [...msgs].reverse().find((m) => m.senderId !== currentUserId);
    if (latestOther) {
      socketManager.markMessageRead(latestOther.id, conversationId);
    }
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === conversationId ? { ...c, unreadCount: 0 } : c,
      ),
    }));
  },

  fetchContacts: async () => {
    try {
      const res = await api.get('/users/contacts');
      const data = unwrapData<Contact[]>(res.data);
      set({ contacts: Array.isArray(data) ? data : [] });
    } catch {
      // Ignore
    }
  },

  addContact: async (phoneNumber, nickname) => {
    try {
      const trimmedNickname = nickname?.trim();
      const res = await api.post('/users/contacts', {
        phone_number: phoneNumber.trim(),
        ...(trimmedNickname ? { nickname: trimmedNickname } : {}),
      });
      const contact = unwrapData<Contact>(res.data);
      set((state) => {
        const exists = state.contacts.some(
          (c) => c.id === contact.id || c.contactId === contact.contactId,
        );
        return {
          contacts: exists
            ? state.contacts.map((c) =>
                c.id === contact.id || c.contactId === contact.contactId ? contact : c,
              )
            : [contact, ...state.contacts],
        };
      });
      await get().fetchContacts();
      return contact;
    } catch (err) {
      throw new Error(extractErrorMessage(err, 'Failed to add contact'));
    }
  },

  removeContact: async (contactId) => {
    try {
      await api.delete(`/users/contacts/${contactId}`);
      set((state) => ({
        contacts: state.contacts.filter(
          (c) => c.id !== contactId && c.contactId !== contactId,
        ),
      }));
    } catch (err) {
      throw new Error(extractErrorMessage(err, 'Failed to remove contact'));
    }
  },

  syncContacts: async (phones) => {
    try {
      const res = await api.post('/users/contacts/sync', {
        contacts: phones.map((phone_number) => ({ phone_number })),
      });
      const data = unwrapData<Contact[]>(res.data);
      const list = Array.isArray(data) ? data : [];
      await get().fetchContacts();
      return list;
    } catch (err) {
      throw new Error(extractErrorMessage(err, 'Failed to sync contacts'));
    }
  },

  searchUsers: async (query, type) => {
    const res = await api.get('/users/search', {
      params: type ? { q: query, type } : { q: query },
    });
    const data = unwrapData<User[]>(res.data);
    return Array.isArray(data) ? data : [];
  },

  fetchBlockedUsers: async () => {
    try {
      const res = await api.get('/users/blocked');
      const data = unwrapData<User[]>(res.data);
      set({ blockedUsers: Array.isArray(data) ? data : [] });
    } catch {
      // Ignore
    }
  },

  blockUser: async (userId) => {
    await api.post(`/users/block/${userId}`);
    await get().fetchBlockedUsers();
  },

  unblockUser: async (userId) => {
    await api.delete(`/users/block/${userId}`);
    set((state) => ({
      blockedUsers: state.blockedUsers.filter((u) => u.id !== userId),
    }));
  },

  fetchStarredMessages: async () => {
    try {
      const res = await api.get('/messages/starred');
      const data = unwrapData<Message[]>(res.data);
      const list = Array.isArray(data) ? data : [];
      const decrypted = await Promise.all(list.map(maybeDecryptMessage));
      set({ starredMessages: decrypted });
    } catch {
      // Ignore
    }
  },

  globalSearch: async (params) => {
    const res = await api.get('/search', { params });
    const raw = unwrapData<Partial<SearchResults>>(res.data);
    const messages = await Promise.all((raw.messages || []).map(maybeDecryptMessage));
    const media = await Promise.all((raw.media || []).map(maybeDecryptMessage));
    return {
      contacts: raw.contacts || [],
      groups: raw.groups || [],
      messages,
      media,
    };
  },

  initSocketListeners: () => {
    if (get().socketInitialized) return () => {};
    set({ socketInitialized: true });

    const handleNewMessage = async (rawMsg: Message) => {
      const currentUserId = useAuthStore.getState().user?.id;
      const dec = await maybeDecryptMessage(rawMsg);
      const convId = dec.conversationId;

      if (dec.senderId !== currentUserId) {
        socketManager.markMessageDelivered(dec.id, convId);
        if (get().activeConversationId === convId) {
          socketManager.markMessageRead(dec.id, convId);
        }
      }

      const convMissing = !get().conversations.some((c) => c.id === convId);

      set((state) => {
        const existingMsgs = state.messagesByConv[convId] || [];
        const alreadyExists = existingMsgs.some((m) => m.id === dec.id);
        const nextMsgs = upsertMessage(existingMsgs, dec, currentUserId);

        const isActive = state.activeConversationId === convId;
        const nextConvs = state.conversations
          .map((c) => {
            if (c.id !== convId) return c;
            return {
              ...c,
              lastMessage: dec,
              updatedAt: dec.createdAt,
              unreadCount:
                !alreadyExists && dec.senderId !== currentUserId && !isActive
                  ? (c.unreadCount || 0) + 1
                  : c.unreadCount || 0,
            };
          })
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

        return {
          messagesByConv: { ...state.messagesByConv, [convId]: nextMsgs },
          conversations: nextConvs,
        };
      });

      if (convMissing) {
        void get().fetchConversations();
      }
    };

    const handleMessageUpdated = async (rawMsg: Message) => {
      const dec = await maybeDecryptMessage(rawMsg);
      set((state) => ({
        messagesByConv: {
          ...state.messagesByConv,
          [dec.conversationId]: (state.messagesByConv[dec.conversationId] || []).map((m) =>
            m.id === dec.id ? { ...m, ...dec } : m,
          ),
        },
      }));
    };

    const handleMessageDeleted = (payload: { messageId: string; conversationId: string; deleteForEveryone?: boolean }) => {
      set((state) => ({
        messagesByConv: {
          ...state.messagesByConv,
          [payload.conversationId]: (state.messagesByConv[payload.conversationId] || []).map((m) =>
            m.id === payload.messageId
              ? { ...m, isDeletedForEveryone: true, content: null, decryptedContent: undefined }
              : m,
          ),
        },
      }));
    };

    const handleReactionUpdate = (payload: {
      messageId: string;
      conversationId: string;
      userId: string;
      emoji: string;
      action?: 'added' | 'removed';
    }) => {
      set((state) => ({
        messagesByConv: {
          ...state.messagesByConv,
          [payload.conversationId]: (state.messagesByConv[payload.conversationId] || []).map((m) => {
            if (m.id !== payload.messageId) return m;
            const existing = m.reactions || [];
            const next =
              payload.action === 'removed'
                ? existing.filter((r) => !(r.userId === payload.userId && r.emoji === payload.emoji))
                : [
                    ...existing.filter((r) => r.userId !== payload.userId),
                    {
                      id: `react-${Date.now()}`,
                      messageId: payload.messageId,
                      userId: payload.userId,
                      emoji: payload.emoji,
                      createdAt: new Date().toISOString(),
                    },
                  ];
            return { ...m, reactions: next };
          }),
        },
      }));
    };

    const handleTyping = (payload: { userId: string; conversationId: string; isTyping?: boolean }) => {
      const currentUserId = useAuthStore.getState().user?.id;
      if (payload.userId === currentUserId) return;
      const isTyping = payload.isTyping ?? true;
      set((state) => ({
        typingByConv: {
          ...state.typingByConv,
          [payload.conversationId]: {
            ...(state.typingByConv[payload.conversationId] || {}),
            [payload.userId]: isTyping,
          },
        },
      }));
    };

    const handleReceipt = (payload: {
      messageId: string;
      conversationId: string;
      status: ReceiptStatus;
      timestamp?: string;
    }) => {
      set((state) => ({
        messagesByConv: {
          ...state.messagesByConv,
          [payload.conversationId]: (state.messagesByConv[payload.conversationId] || []).map((m) => {
            if (m.id !== payload.messageId) return m;
            return {
              ...m,
              deliveredAt:
                payload.status === ReceiptStatus.DELIVERED || payload.status === ReceiptStatus.READ
                  ? payload.timestamp || m.deliveredAt || new Date().toISOString()
                  : m.deliveredAt,
              readAt:
                payload.status === ReceiptStatus.READ
                  ? payload.timestamp || new Date().toISOString()
                  : m.readAt,
            };
          }),
        },
      }));
    };

    const handleOnline = (payload: { userId: string }) => {
      set((state) => ({
        onlineUsers: {
          ...state.onlineUsers,
          [payload.userId]: { isOnline: true, lastSeen: new Date().toISOString() },
        },
      }));
    };

    const handleOffline = (payload: { userId: string; lastSeen?: string }) => {
      set((state) => ({
        onlineUsers: {
          ...state.onlineUsers,
          [payload.userId]: { isOnline: false, lastSeen: payload.lastSeen || new Date().toISOString() },
        },
      }));
    };

    const unsubs = [
      socketManager.on(SocketEvents.MESSAGE_NEW, handleNewMessage),
      socketManager.on('new_message', handleNewMessage),
      socketManager.on(SocketEvents.MESSAGE_EDITED, handleMessageUpdated),
      socketManager.on('message_updated', handleMessageUpdated),
      socketManager.on(SocketEvents.MESSAGE_DELETED, handleMessageDeleted),
      socketManager.on('message_deleted', handleMessageDeleted),
      socketManager.on(SocketEvents.MESSAGE_REACTION_UPDATE, handleReactionUpdate),
      socketManager.on('message_reaction', handleReactionUpdate),
      socketManager.on(SocketEvents.TYPING_UPDATE, handleTyping),
      socketManager.on('typing_indicator', handleTyping),
      socketManager.on(SocketEvents.MESSAGE_RECEIPT_UPDATE, handleReceipt),
      socketManager.on('message_receipt', handleReceipt),
      socketManager.on(SocketEvents.USER_ONLINE, handleOnline),
      socketManager.on('user_online', handleOnline),
      socketManager.on(SocketEvents.USER_OFFLINE, handleOffline),
      socketManager.on('user_offline', handleOffline),
    ];

    return () => {
      unsubs.forEach((u) => u());
      set({ socketInitialized: false });
    };
  },
}));

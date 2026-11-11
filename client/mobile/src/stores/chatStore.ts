import { create } from 'zustand';
import {
  ConversationType,
  MessageType,
  ReceiptStatus,
  SocketEvents,
} from '@whatsapp-pro/shared-types';
import api, { resolveMediaUrl } from '../services/api';
import socketService from '../services/socket';
import e2eeService from '../services/e2ee';
import {
  extractErrorMessage,
  MobileConversation,
  MobileMessage,
  normalizeConversation,
  normalizeMessage,
  unwrapApiData,
} from '../types/mobile.types';
import { useAuthStore } from './authStore';

interface SendMessageParams {
  conversationId: string;
  messageType?: MessageType;
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
  encryptIfDirect?: boolean;
}

interface ChatState {
  conversations: MobileConversation[];
  messagesByConv: Record<string, MobileMessage[]>;
  cursorsByConv: Record<string, string | null>;
  hasMoreByConv: Record<string, boolean>;
  typingUsers: Record<string, string[]>;
  onlineUsers: Record<string, boolean>;
  activeConversationId: string | null;
  replyingTo: MobileMessage | null;
  editingMessage: MobileMessage | null;
  isLoadingChats: boolean;
  isLoadingMessages: Record<string, boolean>;
  error: string | null;
  listenersBound: boolean;

  bindSocketListeners: () => () => void;
  setActiveConversation: (conversationId: string | null) => void;
  setReplyingTo: (msg: MobileMessage | null) => void;
  setEditingMessage: (msg: MobileMessage | null) => void;

  fetchConversations: (refresh?: boolean, silent?: boolean) => Promise<void>;
  fetchMessages: (conversationId: string, loadMore?: boolean, silent?: boolean) => Promise<void>;
  createDirectConversation: (otherUserId: string) => Promise<MobileConversation>;
  sendMessage: (params: SendMessageParams) => Promise<MobileMessage>;
  uploadMediaFile: (file: {
    uri: string;
    name: string;
    type: string;
  }) => Promise<{ url: string; fileName: string; fileSize?: number; mimeType: string }>;
  editMessage: (messageId: string, conversationId: string, newContent: string) => Promise<void>;
  deleteMessage: (messageId: string, conversationId: string, forEveryone: boolean) => Promise<void>;
  toggleReaction: (messageId: string, conversationId: string, emoji: string) => Promise<void>;
  votePoll: (messageId: string, conversationId: string, optionIndex: number) => Promise<void>;
  starMessage: (messageId: string, conversationId: string, starred: boolean) => Promise<void>;
  forwardMessage: (messageId: string, toConversationId: string) => Promise<void>;
  archiveConversation: (conversationId: string, archive: boolean) => Promise<void>;
  muteConversation: (conversationId: string, muted: boolean) => Promise<void>;
  markConversationRead: (conversationId: string) => Promise<void>;
}

async function maybeDecryptMessage(
  msg: MobileMessage,
  conversation?: MobileConversation,
): Promise<MobileMessage> {
  if (!msg.content) return msg;
  const trimmed = msg.content.trim();
  const isMobileCipher = trimmed.startsWith('e2ee:v1:');
  const isSignalCipher =
    trimmed.startsWith('{') &&
    trimmed.includes('"v":1') &&
    (trimmed.includes('"ciphertext"') || trimmed.includes('"type"'));

  if (!msg.isEncrypted && !isMobileCipher) {
    return msg;
  }

  if (isSignalCipher) {
    return {
      ...msg,
      decryptedContent: 'Encrypted message (open on linked Web device)',
    };
  }

  if (!isMobileCipher) {
    return msg;
  }

  const currentUserId = useAuthStore.getState().user?.id;
  const peerId =
    msg.senderId === currentUserId
      ? conversation?.peerUser?.id ?? String(msg.encryptionMetadata?.recipientUserId ?? '')
      : msg.senderId;
  const decrypted = await e2eeService.decryptMessage(
    msg.content,
    msg.isEncrypted,
    msg.encryptionMetadata,
    peerId,
  );
  return { ...msg, decryptedContent: decrypted };
}

function upsertMessage(
  existing: MobileMessage[],
  incoming: MobileMessage,
  replaceTempId?: string,
): MobileMessage[] {
  const withoutReplaced = existing.filter((m) => {
    if (replaceTempId && m.id === replaceTempId) return false;
    // Match in-flight optimistic message if server socket broadcast beats HTTP response
    if (
      !replaceTempId &&
      m.id.startsWith('temp-') &&
      m.senderId === incoming.senderId &&
      m.messageType === incoming.messageType &&
      (m.content === incoming.content ||
        (m.decryptedContent && m.decryptedContent === incoming.decryptedContent))
    ) {
      return false;
    }
    return true;
  });

  const idx = withoutReplaced.findIndex((m) => m.id === incoming.id);
  const next =
    idx >= 0
      ? withoutReplaced.map((m, i) =>
          i === idx
            ? {
                ...m,
                ...incoming,
                decryptedContent: incoming.decryptedContent ?? m.decryptedContent,
              }
            : m,
        )
      : [incoming, ...withoutReplaced];

  // Guarantee unique IDs even if existing array had duplicates
  const seen = new Set<string>();
  const unique: MobileMessage[] = [];
  for (const item of next) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      unique.push(item);
    }
  }
  return unique;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  messagesByConv: {},
  cursorsByConv: {},
  hasMoreByConv: {},
  typingUsers: {},
  onlineUsers: {},
  activeConversationId: null,
  replyingTo: null,
  editingMessage: null,
  isLoadingChats: false,
  isLoadingMessages: {},
  error: null,
  listenersBound: false,

  setActiveConversation: (conversationId) => set({ activeConversationId: conversationId }),
  setReplyingTo: (replyingTo) => set({ replyingTo, editingMessage: null }),
  setEditingMessage: (editingMessage) => set({ editingMessage, replyingTo: null }),

  bindSocketListeners: () => {
    if (get().listenersBound) return () => {};
    set({ listenersBound: true });

    const onNewMessage = async (raw: Record<string, unknown>) => {
      const normalized = normalizeMessage(raw);
      const existingConv = get().conversations.find((c) => c.id === normalized.conversationId);
      const msg = await maybeDecryptMessage(normalized, existingConv);
      const currentUserId = useAuthStore.getState().user?.id;

      if (!existingConv && msg.conversationId) {
        socketService.joinConversation(msg.conversationId);
        get().fetchConversations(true).catch(() => {});
      }

      set((state) => {
        const existing = state.messagesByConv[msg.conversationId] ?? [];
        const deduped = upsertMessage(existing, msg);

        const isViewing = state.activeConversationId === msg.conversationId;
        const alreadyKnown = existing.some((m) => m.id === msg.id);
        const conversations = state.conversations
          .map((c) => {
            if (c.id !== msg.conversationId) return c;
            const shouldIncrement = !alreadyKnown && msg.senderId !== currentUserId && !isViewing;
            return {
              ...c,
              lastMessage: msg,
              updatedAt: msg.createdAt,
              unreadCount: shouldIncrement ? c.unreadCount + 1 : c.unreadCount,
            };
          })
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

        return {
          messagesByConv: { ...state.messagesByConv, [msg.conversationId]: deduped },
          conversations,
        };
      });

      if (msg.senderId !== currentUserId) {
        socketService.markMessageDelivered(msg.id, msg.conversationId);
        if (get().activeConversationId === msg.conversationId) {
          socketService.markMessageRead(msg.id, msg.conversationId);
        }
      }
    };

    const onMessageUpdated = async (raw: Record<string, unknown>) => {
      const normalized = normalizeMessage(raw);
      const conv = get().conversations.find((c) => c.id === normalized.conversationId);
      const msg = await maybeDecryptMessage(normalized, conv);
      set((state) => ({
        messagesByConv: {
          ...state.messagesByConv,
          [msg.conversationId]: (state.messagesByConv[msg.conversationId] ?? []).map((m) =>
            m.id === msg.id ? { ...m, ...msg } : m,
          ),
        },
      }));
    };

    const onMessageDeleted = (payload: { messageId: string; id?: string; conversationId: string; deleteForEveryone?: boolean }) => {
      const targetId = payload.messageId ?? payload.id;
      if (!targetId || !payload.conversationId) return;
      set((state) => ({
        messagesByConv: {
          ...state.messagesByConv,
          [payload.conversationId]: (state.messagesByConv[payload.conversationId] ?? []).map((m) =>
            m.id === targetId
              ? { ...m, isDeletedForEveryone: true, content: 'This message was deleted' }
              : m,
          ),
        },
      }));
    };

    const onReaction = (payload: {
      messageId: string;
      conversationId: string;
      userId: string;
      emoji: string;
      action?: 'added' | 'removed';
    }) => {
      set((state) => {
        const list = state.messagesByConv[payload.conversationId] ?? [];
        const updated = list.map((m) => {
          if (m.id !== payload.messageId) return m;
          const current = m.reactions ?? [];
          const exists = current.some((r) => r.userId === payload.userId && r.emoji === payload.emoji);
          const nextReactions =
            payload.action === 'removed' || exists
              ? current.filter((r) => !(r.userId === payload.userId && r.emoji === payload.emoji))
              : [
                  ...current,
                  {
                    id: `${payload.messageId}_${payload.userId}_${payload.emoji}`,
                    messageId: payload.messageId,
                    userId: payload.userId,
                    emoji: payload.emoji,
                    createdAt: new Date().toISOString(),
                  },
                ];
          return { ...m, reactions: nextReactions };
        });
        return {
          messagesByConv: { ...state.messagesByConv, [payload.conversationId]: updated },
        };
      });
    };

    const onTyping = (payload: { userId: string; conversationId: string; isTyping: boolean }) => {
      const currentUserId = useAuthStore.getState().user?.id;
      if (!payload.conversationId || payload.userId === currentUserId) return;
      set((state) => {
        const current = state.typingUsers[payload.conversationId] ?? [];
        const next = payload.isTyping
          ? Array.from(new Set([...current, payload.userId]))
          : current.filter((id) => id !== payload.userId);
        return {
          typingUsers: { ...state.typingUsers, [payload.conversationId]: next },
        };
      });
    };

    const onReceipt = (payload: {
      messageId: string;
      conversationId: string;
      status: ReceiptStatus;
    }) => {
      if (!payload.conversationId || !payload.messageId) return;
      const now = new Date().toISOString();
      set((state) => ({
        messagesByConv: {
          ...state.messagesByConv,
          [payload.conversationId]: (state.messagesByConv[payload.conversationId] ?? []).map((m) =>
            m.id === payload.messageId
              ? {
                  ...m,
                  deliveredAt: payload.status === ReceiptStatus.DELIVERED ? m.deliveredAt ?? now : m.deliveredAt,
                  readAt: payload.status === ReceiptStatus.READ ? now : m.readAt,
                }
              : m,
          ),
        },
      }));
    };

    const onPresenceOnline = (payload: { userId: string }) => {
      if (!payload?.userId) return;
      set((state) => ({ onlineUsers: { ...state.onlineUsers, [payload.userId]: true } }));
    };

    const onPresenceOffline = (payload: { userId: string }) => {
      if (!payload?.userId) return;
      set((state) => ({ onlineUsers: { ...state.onlineUsers, [payload.userId]: false } }));
    };

    const onReconnect = () => {
      get().fetchConversations(true).catch(() => {});
      const activeId = get().activeConversationId;
      if (activeId) {
        get().fetchMessages(activeId, false).catch(() => {});
      }
    };

    const unsubs = [
      socketService.on(SocketEvents.MESSAGE_NEW, onNewMessage),
      socketService.on('new_message', onNewMessage),
      socketService.on(SocketEvents.MESSAGE_EDITED, onMessageUpdated),
      socketService.on('message_updated', onMessageUpdated),
      socketService.on(SocketEvents.MESSAGE_DELETED, onMessageDeleted),
      socketService.on('message_deleted', onMessageDeleted),
      socketService.on(SocketEvents.MESSAGE_REACTION_UPDATE, onReaction),
      socketService.on('message_reaction', onReaction),
      socketService.on(SocketEvents.TYPING_UPDATE, onTyping),
      socketService.on('typing_indicator', onTyping),
      socketService.on(SocketEvents.MESSAGE_RECEIPT_UPDATE, onReceipt),
      socketService.on('message_receipt', onReceipt),
      socketService.on(SocketEvents.USER_ONLINE, onPresenceOnline),
      socketService.on('user_online', onPresenceOnline),
      socketService.on(SocketEvents.USER_OFFLINE, onPresenceOffline),
      socketService.on('user_offline', onPresenceOffline),
      socketService.on('socket:reconnected', onReconnect),
    ];

    return () => {
      unsubs.forEach((fn) => fn());
      set({ listenersBound: false });
    };
  },

  fetchConversations: async (_refresh = false, silent = false) => {
    if (!silent) {
      set({ isLoadingChats: true, error: null });
    }
    try {
      const res = await api.get('/chats', { params: { limit: 50 } });
      const raw = unwrapApiData<{ items?: Record<string, unknown>[] } | Record<string, unknown>[]>(res.data);
      const list = Array.isArray(raw) ? raw : raw?.items ?? [];
      const currentUserId = useAuthStore.getState().user?.id;
      const conversations = list.map((c) => normalizeConversation(c, currentUserId));

      // Seed onlineUsers map from member user_profiles if included
      const onlineMap = { ...get().onlineUsers };
      list.forEach((rawConv) => {
        const members = (rawConv.members ?? rawConv.conversation_members ?? []) as Record<string, any>[];
        members.forEach((m) => {
          const u = m.user ?? m.users;
          const profile = u?.profile ?? u?.user_profiles;
          if (u?.id && profile && typeof profile.isOnline === 'boolean') {
            onlineMap[u.id] = profile.isOnline;
          } else if (u?.id && profile && typeof profile.is_online === 'boolean') {
            onlineMap[u.id] = profile.is_online;
          }
        });
      });

      set({ conversations, onlineUsers: onlineMap });
      conversations.forEach((c) => {
        if (c.id) socketService.joinConversation(c.id);
      });
    } catch (err) {
      if (!silent) {
        set({ error: extractErrorMessage(err, 'Failed to load chats') });
      }
    } finally {
      if (!silent) {
        set({ isLoadingChats: false });
      }
    }
  },

  fetchMessages: async (conversationId, loadMore = false, silent = false) => {
    const state = get();
    if (state.isLoadingMessages[conversationId]) return;
    if (loadMore && state.hasMoreByConv[conversationId] === false) return;

    if (!silent) {
      set((s) => ({
        isLoadingMessages: { ...s.isLoadingMessages, [conversationId]: true },
      }));
    }

    try {
      const cursor = loadMore ? state.cursorsByConv[conversationId] : undefined;
      const res = await api.get(`/chats/${conversationId}/messages`, {
        params: { limit: 30, ...(cursor ? { cursor } : {}) },
      });
      const payload = unwrapApiData<{
        items?: Record<string, unknown>[];
        messages?: Record<string, unknown>[];
        nextCursor?: string | null;
        hasNextPage?: boolean;
      } | Record<string, unknown>[]>(res.data);

      const rawItems = Array.isArray(payload)
        ? payload
        : payload?.items ?? payload?.messages ?? [];
      const conv = get().conversations.find((c) => c.id === conversationId);
      const normalized = await Promise.all(
        rawItems.map((m) => maybeDecryptMessage(normalizeMessage(m), conv)),
      );

      // Ensure newest-first ordering for inverted FlatList
      normalized.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      const nextCursor = Array.isArray(payload) ? null : payload?.nextCursor ?? null;
      const hasNextPage = Array.isArray(payload) ? false : Boolean(payload?.hasNextPage ?? nextCursor);

      set((s) => {
        const currentList = s.messagesByConv[conversationId] ?? [];
        const existing = loadMore
          ? currentList
          : currentList.filter((m) => m.id.startsWith('temp-'));
        const existingIds = new Set(existing.map((m) => m.id));
        const seenNorm = new Set<string>();
        const freshUnique = normalized.filter((m) => {
          if (existingIds.has(m.id) || seenNorm.has(m.id)) return false;
          seenNorm.add(m.id);
          return true;
        });
        const merged = [...existing, ...freshUnique].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        return {
          messagesByConv: { ...s.messagesByConv, [conversationId]: merged },
          ...(loadMore || !s.cursorsByConv[conversationId]
            ? {
                cursorsByConv: { ...s.cursorsByConv, [conversationId]: nextCursor },
                hasMoreByConv: { ...s.hasMoreByConv, [conversationId]: hasNextPage },
              }
            : {}),
        };
      });
    } catch (err) {
      if (!silent) {
        set({ error: extractErrorMessage(err, 'Failed to load messages') });
      }
    } finally {
      if (!silent) {
        set((s) => ({
          isLoadingMessages: { ...s.isLoadingMessages, [conversationId]: false },
        }));
      }
    }
  },

  createDirectConversation: async (otherUserId) => {
    const res = await api.post('/chats', { otherUserId });
    const raw = unwrapApiData<Record<string, unknown>>(res.data);
    const currentUserId = useAuthStore.getState().user?.id;
    const conv = normalizeConversation(raw, currentUserId);
    set((s) => {
      const exists = s.conversations.some((c) => c.id === conv.id);
      return {
        conversations: exists ? s.conversations : [conv, ...s.conversations],
      };
    });
    if (conv.id) {
      socketService.joinConversation(conv.id);
    }
    return conv;
  },

  uploadMediaFile: async (file) => {
    const formData = new FormData();
    formData.append('file', {
      uri: file.uri,
      name: file.name,
      type: file.type,
    } as unknown as Blob);

    const res = await api.post('/media/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      transformRequest: (data) => data,
    });
    const data = unwrapApiData<Record<string, any>>(res.data);
    const rawUrl = String(data.url ?? data.fileUrl ?? data.file_url ?? '');
    return {
      url: resolveMediaUrl(rawUrl) ?? rawUrl,
      fileName: String(data.fileName ?? data.file_name ?? file.name),
      fileSize: data.fileSize ?? data.file_size,
      mimeType: String(data.mimeType ?? data.mime_type ?? file.type),
    };
  },

  sendMessage: async (params) => {
    const { conversationId, messageType = MessageType.TEXT, content } = params;
    const currentUser = useAuthStore.getState().user;
    const conv = get().conversations.find((c) => c.id === conversationId);

    let payloadContent = content ?? '';
    let isEncrypted = false;
    let encryptionMetadata: Record<string, unknown> | undefined;

    if (
      params.encryptIfDirect === true &&
      messageType === MessageType.TEXT &&
      payloadContent &&
      conv?.type === ConversationType.DIRECT &&
      conv.peerUser?.id
    ) {
      const encrypted = await e2eeService.encryptForUser(conv.peerUser.id, payloadContent);
      if (encrypted) {
        payloadContent = encrypted.ciphertext;
        isEncrypted = true;
        encryptionMetadata = encrypted.encryptionMetadata;
      }
    }

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: MobileMessage = {
      id: tempId,
      conversationId,
      senderId: currentUser?.id ?? '',
      content: payloadContent,
      decryptedContent: content ?? '',
      messageType,
      replyToId: params.replyToId ?? null,
      isEdited: false,
      isDeletedForEveryone: false,
      isViewOnce: Boolean(params.isViewOnce),
      isStarred: false,
      isEncrypted,
      encryptionMetadata: encryptionMetadata ?? null,
      sentAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      localStatus: 'SENDING',
      sender: currentUser,
      attachments: params.attachmentUrl
        ? [
            {
              id: `${tempId}-att`,
              messageId: tempId,
              fileType: messageType,
              fileUrl: params.attachmentUrl,
              fileName: params.attachmentName ?? null,
              fileSize: params.attachmentSize ?? null,
              mimeType: params.mimeType ?? null,
              duration: params.duration ?? null,
              createdAt: new Date().toISOString(),
            },
          ]
        : [],
    };

    set((s) => ({
      messagesByConv: {
        ...s.messagesByConv,
        [conversationId]: [optimistic, ...(s.messagesByConv[conversationId] ?? [])],
      },
      replyingTo: null,
    }));

    try {
      const res = await api.post(`/chats/${conversationId}/messages`, {
        messageType,
        content: payloadContent || undefined,
        replyToId: params.replyToId,
        isViewOnce: params.isViewOnce,
        isEncrypted,
        encryptionMetadata,
        attachmentUrl: params.attachmentUrl,
        attachmentName: params.attachmentName,
        attachmentSize: params.attachmentSize,
        mimeType: params.mimeType,
        duration: params.duration,
        latitude: params.latitude,
        longitude: params.longitude,
        contactName: params.contactName,
        contactPhone: params.contactPhone,
      });

      const savedRaw = unwrapApiData<Record<string, unknown>>(res.data);
      const saved = {
        ...normalizeMessage(savedRaw),
        decryptedContent: content ?? undefined,
        localStatus: 'SENT' as const,
      };

      set((s) => ({
        messagesByConv: {
          ...s.messagesByConv,
          [conversationId]: upsertMessage(s.messagesByConv[conversationId] ?? [], saved, tempId),
        },
        conversations: s.conversations
          .map((c) => (c.id === conversationId ? { ...c, lastMessage: saved, updatedAt: saved.createdAt } : c))
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
      }));

      return saved;
    } catch (err) {
      set((s) => ({
        messagesByConv: {
          ...s.messagesByConv,
          [conversationId]: (s.messagesByConv[conversationId] ?? []).map((m) =>
            m.id === tempId ? { ...m, localStatus: 'FAILED' } : m,
          ),
        },
      }));
      throw new Error(extractErrorMessage(err, 'Failed to send message'));
    }
  },

  editMessage: async (messageId, conversationId, newContent) => {
    await api.patch(`/messages/${messageId}`, { content: newContent });
    set((s) => ({
      messagesByConv: {
        ...s.messagesByConv,
        [conversationId]: (s.messagesByConv[conversationId] ?? []).map((m) =>
          m.id === messageId
            ? { ...m, content: newContent, decryptedContent: newContent, isEdited: true }
            : m,
        ),
      },
      editingMessage: null,
    }));
  },

  deleteMessage: async (messageId, conversationId, forEveryone) => {
    await api.delete(`/messages/${messageId}`, {
      params: { deleteForEveryone: forEveryone },
    });
    set((s) => ({
      messagesByConv: {
        ...s.messagesByConv,
        [conversationId]: forEveryone
          ? (s.messagesByConv[conversationId] ?? []).map((m) =>
              m.id === messageId
                ? { ...m, isDeletedForEveryone: true, content: 'This message was deleted', decryptedContent: undefined }
                : m,
            )
          : (s.messagesByConv[conversationId] ?? []).filter((m) => m.id !== messageId),
      },
    }));
  },

  votePoll: async (messageId, conversationId, optionIndex) => {
    const res = await api.post(`/messages/${messageId}/poll-vote`, { optionIndex });
    const updatedRaw = unwrapApiData<Record<string, unknown>>(res.data);
    if (updatedRaw && updatedRaw.id) {
      const updated = normalizeMessage(updatedRaw);
      set((s) => ({
        messagesByConv: {
          ...s.messagesByConv,
          [conversationId]: (s.messagesByConv[conversationId] ?? []).map((m) =>
            m.id === messageId ? { ...m, content: updated.content, decryptedContent: updated.content } : m,
          ),
        },
      }));
    }
  },

  toggleReaction: async (messageId, conversationId, emoji) => {
    const userId = useAuthStore.getState().user?.id ?? '';
    await api.post(`/messages/${messageId}/reactions`, { emoji });
    set((s) => ({
      messagesByConv: {
        ...s.messagesByConv,
        [conversationId]: (s.messagesByConv[conversationId] ?? []).map((m) => {
          if (m.id !== messageId) return m;
          const existing = m.reactions ?? [];
          const has = existing.some((r) => r.userId === userId && r.emoji === emoji);
          return {
            ...m,
            reactions: has
              ? existing.filter((r) => !(r.userId === userId && r.emoji === emoji))
              : [
                  ...existing,
                  {
                    id: `${messageId}_${userId}_${emoji}`,
                    messageId,
                    userId,
                    emoji,
                    createdAt: new Date().toISOString(),
                  },
                ],
          };
        }),
      },
    }));
  },

  starMessage: async (messageId, conversationId, starred) => {
    if (starred) {
      await api.post(`/messages/${messageId}/star`);
    } else {
      await api.delete(`/messages/${messageId}/star`);
    }
    set((s) => ({
      messagesByConv: {
        ...s.messagesByConv,
        [conversationId]: (s.messagesByConv[conversationId] ?? []).map((m) =>
          m.id === messageId ? { ...m, isStarred: starred } : m,
        ),
      },
    }));
  },

  forwardMessage: async (messageId, toConversationId) => {
    await api.post(`/messages/${messageId}/forward`, { toConversationId });
    await get().fetchMessages(toConversationId, false);
  },

  archiveConversation: async (conversationId, archive) => {
    if (archive) {
      await api.post(`/chats/${conversationId}/archive`);
    } else {
      await api.delete(`/chats/${conversationId}/archive`);
    }
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conversationId ? { ...c, isArchived: archive } : c,
      ),
    }));
  },

  muteConversation: async (conversationId, muted) => {
    await api.patch(`/settings/notifications/${conversationId}`, {
      isMuted: muted,
    });
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conversationId ? { ...c, isMuted: muted } : c,
      ),
    }));
  },

  markConversationRead: async (conversationId) => {
    const msgs = get().messagesByConv[conversationId] ?? [];
    const currentUserId = useAuthStore.getState().user?.id;
    const latestOther = msgs.find((m) => m.senderId !== currentUserId);
    if (latestOther) {
      socketService.markMessageRead(latestOther.id, conversationId);
    }
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conversationId ? { ...c, unreadCount: 0 } : c,
      ),
    }));
  },
}));

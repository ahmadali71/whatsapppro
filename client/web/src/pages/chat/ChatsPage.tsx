import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Search,
  MessageSquarePlus,
  Users,
  UserPlus,
  Phone,
  Video,
  Info,
  ArrowLeft,
  Pin,
  Archive,
  BellOff,
  Lock,
  Clock,
  ChevronUp,
  ChevronDown,
  Check,
  CheckCheck,
  X,
  Star,
  MoreVertical,
} from 'lucide-react';
import {
  CallType,
  ConversationType,
  FontSize,
  User,
} from '@whatsapp-pro/shared-types';
import { useAuthStore } from '@/stores/authStore';
import { ConversationWithMeta, LocalMessage, useChatStore } from '@/stores/chatStore';
import { useCallStore } from '@/stores/callStore';
import { useThemeStore, WALLPAPER_PRESETS } from '@/stores/themeStore';
import { socketManager } from '@/lib/socket';
import { Avatar } from '@/components/common/Avatar';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { MessageComposer } from '@/components/chat/MessageComposer';
import { ConversationInfoDrawer } from '@/components/chat/ConversationInfoDrawer';
import {
  CreateGroupModal,
  ForwardModal,
  GlobalSearchModal,
  MessageInfoModal,
  NewChatModal,
} from '@/components/chat/ChatModals';
import { toast } from '@/stores/toastStore';

type ChatFilterTab = 'all' | 'unread' | 'groups' | 'archived';

function getConversationTitle(conv: ConversationWithMeta, currentUserId: string): string {
  if (conv.type === ConversationType.GROUP || conv.type === ConversationType.COMMUNITY) {
    return conv.group?.name || 'Group Chat';
  }
  const other = conv.members?.find((m) => m.userId !== currentUserId)?.user;
  return other?.displayName || other?.phoneNumber || 'Direct Chat';
}

function getConversationAvatar(conv: ConversationWithMeta, currentUserId: string): string | null | undefined {
  if (conv.type === ConversationType.GROUP || conv.type === ConversationType.COMMUNITY) {
    return conv.group?.avatarUrl;
  }
  const other = conv.members?.find((m) => m.userId !== currentUserId)?.user;
  return other?.avatarUrl;
}

function formatChatTime(dateVal?: string | Date): string {
  if (!dateVal) return '';
  const d = new Date(dateVal);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatDateSeparator(dateVal: string | Date): string {
  const d = new Date(dateVal);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export const ChatsPage: React.FC<{ initialFilter?: ChatFilterTab; showStarredOnly?: boolean }> = ({
  initialFilter = 'all',
  showStarredOnly = false,
}) => {
  const { conversationId: routeConvId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();

  const { user } = useAuthStore();
  const {
    conversations,
    activeConversationId,
    messagesByConv,
    hasMoreByConv,
    typingByConv,
    onlineUsers,
    pinnedConversationIds,
    pinnedMessageIds,
    starredMessages,
    isLoadingConversations,
    isLoadingMessages,
    setActiveConversation,
    fetchConversations,
    fetchMessages,
    fetchContacts,
    fetchBlockedUsers,
    fetchStarredMessages,
    setReplyingTo,
    setEditingMessage,
    deleteMessage,
    toggleReaction,
    toggleStar,
    togglePinConversation,
    togglePinMessage,
    archiveConversation,
    muteConversation,
    retryMessage,
    votePoll,
  } = useChatStore();

  const { initiateCall } = useCallStore();
  const { resolvedTheme, wallpaper, customWallpaperUrl, fontSize } = useThemeStore();

  const [filterTab, setFilterTab] = useState<ChatFilterTab>(initialFilter);
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [inChatSearchOpen, setInChatSearchOpen] = useState(false);
  const [inChatSearchQuery, setInChatSearchQuery] = useState('');
  const [infoDrawerOpen, setInfoDrawerOpen] = useState(false);

  // Modals
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newChatMode, setNewChatMode] = useState<'chat' | 'add_contact'>('chat');
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [socketConnected, setSocketConnected] = useState(socketManager.isConnected);
  const [forwardingMsg, setForwardingMsg] = useState<LocalMessage | null>(null);
  const [infoMsg, setInfoMsg] = useState<LocalMessage | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [convMenuId, setConvMenuId] = useState<string | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const currentUserId = user?.id || '';

  const openContactsModal = (mode: 'chat' | 'add_contact' = 'chat') => {
    setNewChatMode(mode);
    setNewChatOpen(true);
  };

  useEffect(() => socketManager.onConnectionChange(setSocketConnected), []);

  // Fast, flicker-free HTTP polling when WebSocket is unavailable (e.g. serverless deployment)
  useEffect(() => {
    if (socketConnected) return;

    const syncNow = () => {
      if (document.visibilityState !== 'visible') return;
      void fetchConversations({ silent: true });
      if (activeConversationId) {
        void fetchMessages(activeConversationId, false, { silent: true });
      }
    };

    const msgInterval = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || !activeConversationId) return;
      void fetchMessages(activeConversationId, false, { silent: true });
    }, 2500);

    const convInterval = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void fetchConversations({ silent: true });
    }, 4000);

    window.addEventListener('focus', syncNow);
    document.addEventListener('visibilitychange', syncNow);

    return () => {
      window.clearInterval(msgInterval);
      window.clearInterval(convInterval);
      window.removeEventListener('focus', syncNow);
      document.removeEventListener('visibilitychange', syncNow);
    };
  }, [socketConnected, activeConversationId, fetchConversations, fetchMessages]);

  useEffect(() => {
    setFilterTab(initialFilter);
  }, [initialFilter]);

  useEffect(() => {
    void fetchConversations();
    void fetchContacts();
    void fetchBlockedUsers();
    if (showStarredOnly) {
      void fetchStarredMessages();
    }
  }, [fetchConversations, fetchContacts, fetchBlockedUsers, fetchStarredMessages, showStarredOnly]);

  useEffect(() => {
    if (routeConvId && routeConvId !== activeConversationId) {
      setActiveConversation(routeConvId);
    }
  }, [routeConvId, activeConversationId, setActiveConversation]);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) || null,
    [conversations, activeConversationId],
  );

  const activeMessages = useMemo(() => {
    if (!activeConversationId) return [];
    const list = messagesByConv[activeConversationId] || [];
    if (!inChatSearchQuery.trim()) return list;
    const q = inChatSearchQuery.toLowerCase();
    return list.filter((m) => (m.decryptedContent || m.content || '').toLowerCase().includes(q));
  }, [messagesByConv, activeConversationId, inChatSearchQuery]);

  // Auto scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages.length, activeConversationId]);

  const filteredConversations = useMemo(() => {
    const q = sidebarSearch.trim().toLowerCase();
    return conversations
      .filter((c) => {
        if (filterTab === 'archived') return c.isArchived;
        if (c.isArchived) return false;
        if (filterTab === 'unread') return (c.unreadCount || 0) > 0;
        if (filterTab === 'groups') return c.type === ConversationType.GROUP;
        return true;
      })
      .filter((c) => {
        if (!q) return true;
        const title = getConversationTitle(c, currentUserId).toLowerCase();
        const preview = (c.lastMessage?.decryptedContent || c.lastMessage?.content || '').toLowerCase();
        return title.includes(q) || preview.includes(q);
      })
      .sort((a, b) => {
        const aPinned = pinnedConversationIds.includes(a.id) ? 1 : 0;
        const bPinned = pinnedConversationIds.includes(b.id) ? 1 : 0;
        if (aPinned !== bPinned) return bPinned - aPinned;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
  }, [conversations, filterTab, sidebarSearch, currentUserId, pinnedConversationIds]);

  const wallpaperStyle = useMemo(() => {
    if (wallpaper === 'custom' && customWallpaperUrl) {
      return {
        backgroundImage: `url(${customWallpaperUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      };
    }
    const preset = WALLPAPER_PRESETS.find((w) => w.id === wallpaper) || WALLPAPER_PRESETS[0];
    return {
      backgroundColor: resolvedTheme === 'dark' ? preset.darkBg : preset.lightBg,
      backgroundImage: preset.pattern,
      backgroundSize: preset.pattern ? '24px 24px' : undefined,
    };
  }, [wallpaper, customWallpaperUrl, resolvedTheme]);

  const fontSizeClass =
    fontSize === FontSize.SMALL ? 'text-xs' : fontSize === FontSize.LARGE ? 'text-base' : 'text-sm';

  const handleSelectConversation = (convId: string) => {
    setActiveConversation(convId);
    navigate(`/chats/${convId}`);
  };

  const handleStartCall = async (type: CallType) => {
    if (!activeConversation) return;
    const peers: User[] = (activeConversation.members || [])
      .map((m) => m.user)
      .filter((u): u is User => Boolean(u && u.id !== currentUserId));
    try {
      await initiateCall(activeConversation.id, type, peers);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to start call (check mic/camera permissions)');
    }
  };

  const handleVotePoll = async (msg: LocalMessage, optionId: string) => {
    try {
      await votePoll(msg.id, msg.conversationId, optionId);
    } catch {
      toast.error('Failed to record vote');
    }
  };

  const pinnedIdsForActive = activeConversationId ? pinnedMessageIds[activeConversationId] || [] : [];
  const latestPinnedMsg = pinnedIdsForActive.length
    ? activeMessages.find((m) => m.id === pinnedIdsForActive[pinnedIdsForActive.length - 1])
    : null;

  const activeOtherUser =
    activeConversation && activeConversation.type === ConversationType.DIRECT
      ? activeConversation.members?.find((m) => m.userId !== currentUserId)?.user
      : undefined;

  const activeTypingUsers = activeConversationId
    ? Object.entries(typingByConv[activeConversationId] || {})
        .filter(([, typing]) => typing)
        .map(([uid]) => uid)
    : [];

  const activeOnlineStatus = activeOtherUser ? onlineUsers[activeOtherUser.id] : undefined;

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden bg-white dark:bg-[#111b21]">
      {/* LEFT PANEL: Chat List Sidebar */}
      <section
        className={`${
          activeConversation ? 'hidden md:flex' : 'flex'
        } flex-col w-full md:w-[340px] lg:w-[380px] border-r border-gray-200 dark:border-[#2a3942] bg-white dark:bg-[#111b21] shrink-0 h-full`}
      >
        {/* Sidebar Header */}
        <div className="h-14 px-4 flex items-center justify-between bg-[#f0f2f5] dark:bg-[#202c33] border-b border-gray-200 dark:border-[#2a3942] shrink-0">
          <h1 className="text-lg font-bold tracking-tight">
            {showStarredOnly ? 'Starred Messages' : filterTab === 'archived' ? 'Archived' : 'Chats'}
          </h1>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setGlobalSearchOpen(true)}
              className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-[#2a3942] text-[#54656f] dark:text-[#aebac1]"
              title="Global Search"
            >
              <Search className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => openContactsModal('add_contact')}
              className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-[#2a3942] text-[#00A884]"
              title="Add Contact"
            >
              <UserPlus className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => setCreateGroupOpen(true)}
              className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-[#2a3942] text-[#54656f] dark:text-[#aebac1]"
              title="Create Group"
            >
              <Users className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => openContactsModal('chat')}
              className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-[#2a3942] text-[#00A884]"
              title="New Chat"
            >
              <MessageSquarePlus className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search & Filter Tabs */}
        {!showStarredOnly && (
          <div className="p-2.5 space-y-2 border-b border-gray-100 dark:border-[#2a3942]">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#f0f2f5] dark:bg-[#202c33]">
              <Search className="w-4 h-4 text-[#667781]" />
              <input
                type="text"
                value={sidebarSearch}
                onChange={(e) => setSidebarSearch(e.target.value)}
                placeholder="Search or start new chat"
                className="flex-1 bg-transparent text-sm focus:outline-none"
              />
              {sidebarSearch && (
                <button type="button" onClick={() => setSidebarSearch('')}>
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto">
              {(['all', 'unread', 'groups', 'archived'] as ChatFilterTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setFilterTab(tab)}
                  className={`px-3 py-1 rounded-full text-xs font-medium capitalize transition ${
                    filterTab === tab
                      ? 'bg-[#00A884]/15 text-[#00A884] font-semibold'
                      : 'bg-[#f0f2f5] dark:bg-[#202c33] text-[#667781] dark:text-[#8696a0] hover:bg-gray-200 dark:hover:bg-[#2a3942]'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* List Body */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-[#202c33]">
          {showStarredOnly ? (
            starredMessages.length === 0 ? (
              <div className="p-8 text-center text-sm text-[#667781]">
                <Star className="w-10 h-10 mx-auto mb-2 text-amber-400 opacity-60" />
                No starred messages yet
              </div>
            ) : (
              starredMessages.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleSelectConversation(m.conversationId)}
                  className="w-full p-3.5 text-left hover:bg-[#f5f6f6] dark:hover:bg-[#202c33]"
                >
                  <div className="flex justify-between text-xs text-[#667781] mb-1">
                    <span className="flex items-center gap-1 text-amber-500 font-medium">
                      <Star className="w-3.5 h-3.5 fill-amber-400" /> Starred
                    </span>
                    <span>{formatChatTime(m.createdAt)}</span>
                  </div>
                  <p className="text-sm truncate">{m.decryptedContent || m.content || m.messageType}</p>
                </button>
              ))
            )
          ) : isLoadingConversations && conversations.length === 0 ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-3 animate-pulse">
                  <div className="w-11 h-11 rounded-full bg-gray-200 dark:bg-[#202c33]" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 bg-gray-200 dark:bg-[#202c33] rounded w-1/2" />
                    <div className="h-3 bg-gray-200 dark:bg-[#202c33] rounded w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm font-medium text-[#667781] dark:text-[#8696a0] mb-3">
                No conversations found
              </p>
              <button
                type="button"
                onClick={() => setNewChatOpen(true)}
                className="px-4 py-2 rounded-xl bg-[#00A884] text-white text-xs font-semibold"
              >
                Start a New Chat
              </button>
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const title = getConversationTitle(conv, currentUserId);
              const avatar = getConversationAvatar(conv, currentUserId);
              const isGroup = conv.type === ConversationType.GROUP;
              const otherMember = !isGroup
                ? conv.members?.find((m) => m.userId !== currentUserId)
                : undefined;
              const isOnline = otherMember ? onlineUsers[otherMember.userId]?.isOnline : false;
              const isTyping = Object.values(typingByConv[conv.id] || {}).some(Boolean);
              const isPinned = pinnedConversationIds.includes(conv.id);
              const isSelected = conv.id === activeConversationId;

              return (
                <div
                  key={conv.id}
                  onClick={() => handleSelectConversation(conv.id)}
                  className={`group relative flex items-center gap-3 px-3.5 py-3 cursor-pointer transition ${
                    isSelected
                      ? 'bg-[#f0f2f5] dark:bg-[#2a3942]'
                      : 'hover:bg-[#f5f6f6] dark:hover:bg-[#202c33]'
                  }`}
                >
                  <Avatar src={avatar} name={title} size="md" isOnline={isOnline} isGroup={isGroup} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-sm truncate">{title}</p>
                      <span
                        className={`text-[11px] shrink-0 ${
                          (conv.unreadCount || 0) > 0
                            ? 'text-[#25D366] font-semibold'
                            : 'text-[#667781] dark:text-[#8696a0]'
                        }`}
                      >
                        {formatChatTime(conv.lastMessage?.createdAt || conv.updatedAt)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <p className="text-xs text-[#667781] dark:text-[#8696a0] truncate flex items-center gap-1">
                        {isTyping ? (
                          <span className="text-[#25D366] font-medium">typing...</span>
                        ) : conv.lastMessage ? (
                          <>
                            {conv.lastMessage.senderId === currentUserId &&
                              !conv.lastMessage.isDeletedForEveryone &&
                              (conv.lastMessage.readAt ? (
                                <CheckCheck className="w-3.5 h-3.5 text-[#53bdeb] shrink-0" />
                              ) : conv.lastMessage.deliveredAt ? (
                                <CheckCheck className="w-3.5 h-3.5 text-[#667781] dark:text-[#8696a0] shrink-0" />
                              ) : (
                                <Check className="w-3.5 h-3.5 text-[#667781] dark:text-[#8696a0] shrink-0" />
                              ))}
                            {conv.lastMessage.isEncrypted && <Lock className="w-3 h-3 shrink-0" />}
                            <span className="truncate">
                              {conv.lastMessage.isDeletedForEveryone
                                ? 'Message deleted'
                                : (conv.lastMessage as LocalMessage).decryptedContent ||
                                  conv.lastMessage.content ||
                                  conv.lastMessage.messageType}
                            </span>
                          </>
                        ) : (
                          <span>No messages yet</span>
                        )}
                      </p>

                      <div className="flex items-center gap-1 shrink-0">
                        {conv.isMuted && <BellOff className="w-3.5 h-3.5 text-[#8696a0]" />}
                        {isPinned && <Pin className="w-3.5 h-3.5 text-[#8696a0]" />}
                        {(conv.unreadCount || 0) > 0 && (
                          <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#25D366] text-white text-[11px] font-bold flex items-center justify-center">
                            {conv.unreadCount}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConvMenuId((prev) => (prev === conv.id ? null : conv.id));
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded-full hover:bg-gray-200 dark:hover:bg-[#3b4a54]"
                        >
                          <MoreVertical className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {convMenuId === conv.id && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      onMouseLeave={() => setConvMenuId(null)}
                      className="absolute right-4 top-11 z-30 w-40 bg-white dark:bg-[#233138] rounded-xl shadow-xl border border-gray-200 dark:border-[#2a3942] py-1 text-xs"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          togglePinConversation(conv.id);
                          setConvMenuId(null);
                        }}
                        className="w-full px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-[#182229] flex items-center gap-2"
                      >
                        <Pin className="w-3.5 h-3.5" /> {isPinned ? 'Unpin' : 'Pin chat'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void muteConversation(conv.id, !conv.isMuted);
                          setConvMenuId(null);
                        }}
                        className="w-full px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-[#182229] flex items-center gap-2"
                      >
                        <BellOff className="w-3.5 h-3.5" /> {conv.isMuted ? 'Unmute' : 'Mute'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void archiveConversation(conv.id, !conv.isArchived);
                          setConvMenuId(null);
                        }}
                        className="w-full px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-[#182229] flex items-center gap-2"
                      >
                        <Archive className="w-3.5 h-3.5" /> {conv.isArchived ? 'Unarchive' : 'Archive'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* CENTER PANEL: Active Conversation */}
      {activeConversation ? (
        <section className="flex-1 flex flex-col min-w-0 h-full">
          {/* Conversation Header */}
          <header className="h-14 px-4 bg-[#f0f2f5] dark:bg-[#202c33] border-b border-gray-200 dark:border-[#2a3942] flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => {
                  setActiveConversation(null);
                  navigate('/');
                }}
                className="md:hidden p-1.5 rounded-full hover:bg-gray-200 dark:hover:bg-[#2a3942]"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>

              <button
                type="button"
                onClick={() => setInfoDrawerOpen((v) => !v)}
                className="flex items-center gap-3 min-w-0 text-left"
              >
                <Avatar
                  src={getConversationAvatar(activeConversation, currentUserId)}
                  name={getConversationTitle(activeConversation, currentUserId)}
                  size="sm"
                  isOnline={activeOnlineStatus?.isOnline}
                  isGroup={activeConversation.type === ConversationType.GROUP}
                />
                <div className="min-w-0">
                  <h2 className="font-semibold text-sm truncate">
                    {getConversationTitle(activeConversation, currentUserId)}
                  </h2>
                  <p className="text-[11px] text-[#667781] dark:text-[#8696a0] truncate">
                    {activeTypingUsers.length > 0 ? (
                      <span className="text-[#25D366] font-medium">typing...</span>
                    ) : activeConversation.type === ConversationType.GROUP ? (
                      `${activeConversation.members?.length || 0} participants`
                    ) : activeOnlineStatus?.isOnline ? (
                      <span className="text-[#25D366]">online</span>
                    ) : activeOnlineStatus?.lastSeen ? (
                      `last seen ${formatChatTime(activeOnlineStatus.lastSeen)}`
                    ) : (
                      'click for contact info'
                    )}
                  </p>
                </div>
              </button>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void handleStartCall(CallType.VIDEO)}
                className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-[#2a3942] text-[#54656f] dark:text-[#aebac1]"
                title="Video Call"
              >
                <Video className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => void handleStartCall(CallType.AUDIO)}
                className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-[#2a3942] text-[#54656f] dark:text-[#aebac1]"
                title="Voice Call"
              >
                <Phone className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setInChatSearchOpen((v) => !v)}
                className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-[#2a3942] text-[#54656f] dark:text-[#aebac1]"
                title="Search in conversation"
              >
                <Search className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setInfoDrawerOpen((v) => !v)}
                className={`p-2 rounded-full transition ${
                  infoDrawerOpen
                    ? 'bg-[#00A884]/15 text-[#00A884]'
                    : 'hover:bg-gray-200 dark:hover:bg-[#2a3942] text-[#54656f] dark:text-[#aebac1]'
                }`}
                title="Conversation Info"
              >
                <Info className="w-5 h-5" />
              </button>
            </div>
          </header>

          {/* In-chat Search Bar */}
          {inChatSearchOpen && (
            <div className="px-4 py-2 bg-white dark:bg-[#202c33] border-b border-gray-200 dark:border-[#2a3942] flex items-center gap-2">
              <Search className="w-4 h-4 text-[#00A884]" />
              <input
                type="text"
                value={inChatSearchQuery}
                onChange={(e) => setInChatSearchQuery(e.target.value)}
                placeholder="Search messages in this chat..."
                className="flex-1 bg-transparent text-sm focus:outline-none"
                autoFocus
              />
              <button
                type="button"
                onClick={() => {
                  setInChatSearchOpen(false);
                  setInChatSearchQuery('');
                }}
              >
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>
          )}

          {/* Pinned Message Banner */}
          {latestPinnedMsg && (
            <div className="px-4 py-2 bg-white/95 dark:bg-[#202c33]/95 border-b border-gray-200 dark:border-[#2a3942] flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <Pin className="w-3.5 h-3.5 text-[#00A884] shrink-0" />
                <span className="font-semibold text-[#00A884]">Pinned:</span>
                <span className="truncate">
                  {latestPinnedMsg.decryptedContent || latestPinnedMsg.content || latestPinnedMsg.messageType}
                </span>
              </div>
              <button
                type="button"
                onClick={() => togglePinMessage(activeConversation.id, latestPinnedMsg.id)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Messages Viewport */}
          <div
            className="flex-1 overflow-y-auto py-3 space-y-1 relative"
            style={wallpaperStyle}
            onScroll={(e) => {
              const el = e.currentTarget;
              const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
              setShowScrollDown(distFromBottom > 240);
            }}
          >
            {/* Cursor Pagination Load Older */}
            {hasMoreByConv[activeConversation.id] && (
              <div className="flex justify-center py-2">
                <button
                  type="button"
                  disabled={isLoadingMessages}
                  onClick={() => void fetchMessages(activeConversation.id, true)}
                  className="px-3.5 py-1.5 rounded-full bg-white/90 dark:bg-[#202c33]/90 text-xs font-medium shadow-sm flex items-center gap-1.5 hover:bg-white"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                  {isLoadingMessages ? 'Loading...' : 'Load older messages'}
                </button>
              </div>
            )}

            {/* E2EE Banner */}
            <div className="flex justify-center px-4 py-2">
              <div className="max-w-md px-3 py-1.5 rounded-xl bg-[#ffeecd]/90 dark:bg-[#182229]/90 text-[#54656f] dark:text-[#ffd279] text-[11px] text-center shadow-sm flex items-center gap-1.5">
                <Lock className="w-3 h-3 shrink-0" />
                <span>
                  Messages and calls are end-to-end encrypted with Signal Protocol.
                </span>
              </div>
            </div>

            {activeConversation.disappearingMessagesTimeout ? (
              <div className="flex justify-center px-4 pb-2">
                <div className="px-3 py-1 rounded-full bg-white/85 dark:bg-[#202c33]/85 text-[11px] text-[#667781] dark:text-[#8696a0] flex items-center gap-1.5 shadow-sm">
                  <Clock className="w-3 h-3 text-[#00A884]" />
                  Disappearing messages enabled
                </div>
              </div>
            ) : null}

            {activeMessages.map((msg, idx) => {
              const prevMsg = idx > 0 ? activeMessages[idx - 1] : null;
              const currDate = new Date(msg.createdAt).toDateString();
              const prevDate = prevMsg ? new Date(prevMsg.createdAt).toDateString() : null;
              const showDate = currDate !== prevDate;

              return (
                <React.Fragment key={msg.id}>
                  {showDate && (
                    <div className="flex justify-center my-2">
                      <span className="px-3 py-1 rounded-lg bg-white/90 dark:bg-[#202c33]/90 text-[11px] font-medium text-[#54656f] dark:text-[#8696a0] shadow-sm">
                        {formatDateSeparator(msg.createdAt)}
                      </span>
                    </div>
                  )}
                  <MessageBubble
                    message={msg}
                    isOwn={msg.senderId === currentUserId}
                    showSenderName={activeConversation.type === ConversationType.GROUP}
                    isPinned={pinnedIdsForActive.includes(msg.id)}
                    currentUserId={currentUserId}
                    fontSizeClass={fontSizeClass}
                    onReply={(m) => setReplyingTo(m)}
                    onForward={(m) => setForwardingMsg(m)}
                    onEdit={(m) => setEditingMessage(m)}
                    onDelete={(m, forEveryone) =>
                      void deleteMessage(m.id, m.conversationId, forEveryone)
                    }
                    onStar={(m) => void toggleStar(m.id, m.conversationId, m.isStarred)}
                    onPin={(m) => togglePinMessage(m.conversationId, m.id)}
                    onReact={(m, emoji) => void toggleReaction(m.id, m.conversationId, emoji)}
                    onShowInfo={(m) => setInfoMsg(m)}
                    onRetry={(tempId) => void retryMessage(activeConversation.id, tempId)}
                    onVotePoll={(m, optId) => void handleVotePoll(m, optId)}
                    onJumpToMessage={(id) => {
                      document.getElementById(`msg-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }}
                    onImagePreview={(url) => setLightboxUrl(url)}
                  />
                </React.Fragment>
              );
            })}
            <div ref={messagesEndRef} />
            {showScrollDown && (
              <button
                type="button"
                onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
                className="sticky bottom-3 ml-auto mr-4 w-9 h-9 rounded-full bg-white dark:bg-[#202c33] border border-gray-200 dark:border-[#2a3942] shadow-lg flex items-center justify-center text-[#54656f] dark:text-[#aebac1] hover:text-[#00A884] transition z-20"
                title="Scroll to latest messages"
              >
                <ChevronDown className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Composer */}
          <MessageComposer conversation={activeConversation} currentUserId={currentUserId} />
        </section>
      ) : (
        <section className="hidden md:flex flex-1 flex-col items-center justify-center bg-[#f0f2f5] dark:bg-[#222e35] text-center p-8 border-b-4 border-[#00A884]">
          <div className="w-20 h-20 rounded-3xl bg-[#00A884]/15 text-[#00A884] flex items-center justify-center mb-6">
            <Lock className="w-10 h-10" />
          </div>
          <h2 className="text-2xl font-light text-[#41525d] dark:text-[#e9edef] mb-2">
            WhatsApp Pro Web
          </h2>
          <p className="text-sm text-[#667781] dark:text-[#8696a0] max-w-md mb-6">
            Select a conversation or start a new chat. All private 1:1 chats are protected with client-side Signal Protocol end-to-end encryption.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => openContactsModal('add_contact')}
              className="px-5 py-2.5 rounded-full bg-[#00A884] hover:bg-[#008f6f] text-white text-sm font-medium transition inline-flex items-center gap-2"
            >
              <UserPlus className="w-4 h-4" />
              Add Contact
            </button>
            <button
              type="button"
              onClick={() => openContactsModal('chat')}
              className="px-5 py-2.5 rounded-full border border-[#00A884] text-[#00A884] hover:bg-[#00A884]/10 text-sm font-medium transition"
            >
              Start New Chat
            </button>
            <button
              type="button"
              onClick={() => setCreateGroupOpen(true)}
              className="px-5 py-2.5 rounded-full border border-gray-300 dark:border-[#3b4a54] hover:bg-gray-200/50 dark:hover:bg-[#2a3942] text-sm font-medium transition"
            >
              Create Group
            </button>
          </div>
        </section>
      )}

      {/* RIGHT PANEL: Info Drawer */}
      {activeConversation && infoDrawerOpen && (
        <ConversationInfoDrawer
          conversation={activeConversation}
          messages={activeMessages}
          currentUserId={currentUserId}
          onClose={() => setInfoDrawerOpen(false)}
        />
      )}

      {/* Modals */}
      <GlobalSearchModal
        open={globalSearchOpen}
        onClose={() => setGlobalSearchOpen(false)}
        onSelectConversation={handleSelectConversation}
      />
      <NewChatModal
        open={newChatOpen}
        initialMode={newChatMode}
        onClose={() => setNewChatOpen(false)}
        onChatCreated={handleSelectConversation}
      />
      <CreateGroupModal
        open={createGroupOpen}
        onClose={() => setCreateGroupOpen(false)}
        onGroupCreated={(cid) => {
          if (cid) handleSelectConversation(cid);
        }}
      />
      <ForwardModal
        message={forwardingMsg}
        conversations={conversations}
        currentUserId={currentUserId}
        onClose={() => setForwardingMsg(null)}
      />
      <MessageInfoModal message={infoMsg} onClose={() => setInfoMsg(null)} />

      {/* Image Lightbox */}
      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          className="fixed inset-0 z-[80] bg-black/90 flex items-center justify-center p-4"
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={lightboxUrl}
            alt="Preview"
            className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain"
          />
        </div>
      )}
    </div>
  );
};

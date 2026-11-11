import React, { useState } from 'react';
import {
  Search,
  X,
  Users,
  MessageSquare,
  Star,
  Image as ImageIcon,
  Check,
  CheckCheck,
  RefreshCw,
  Forward,
  Calendar,
} from 'lucide-react';
import { ConversationType, User } from '@whatsapp-pro/shared-types';
import { ConversationWithMeta, LocalMessage, SearchResults, useChatStore } from '@/stores/chatStore';
import { groupsApi, mediaApi } from '@/services/api.services';
import { Avatar } from '@/components/common/Avatar';
import { toast } from '@/stores/toastStore';

export const GlobalSearchModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onSelectConversation: (conversationId: string) => void;
}> = ({ open, onClose, onSelectConversation }) => {
  const { globalSearch, starredMessages, fetchStarredMessages, createDirectChat, conversations } =
    useChatStore();

  const [query, setQuery] = useState('');
  const [type, setType] = useState<'all' | 'contacts' | 'messages' | 'groups' | 'media' | 'starred'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [conversationId, setConversationId] = useState('');
  const [results, setResults] = useState<SearchResults>({
    contacts: [],
    messages: [],
    groups: [],
    media: [],
  });
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (type === 'starred') {
      setLoading(true);
      await fetchStarredMessages();
      setLoading(false);
      return;
    }
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await globalSearch({
        q: query.trim(),
        type,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        conversationId: conversationId || undefined,
      });
      setResults(res);
    } catch {
      toast.error('Search failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm p-4 pt-12">
      <div className="bg-white dark:bg-[#202c33] rounded-2xl shadow-2xl border border-gray-200 dark:border-[#2a3942] max-w-2xl w-full overflow-hidden flex flex-col max-h-[82vh]">
        <form onSubmit={handleSearch} className="p-4 border-b border-gray-200 dark:border-[#2a3942] space-y-3">
          <div className="flex items-center gap-2">
            <Search className="w-5 h-5 text-[#00A884]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search messages, contacts, groups, links, or media..."
              className="flex-1 bg-transparent text-sm focus:outline-none"
              autoFocus
            />
            <button
              type="submit"
              className="px-3 py-1.5 rounded-lg bg-[#00A884] text-white text-xs font-semibold"
            >
              Search
            </button>
            <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(['all', 'contacts', 'messages', 'groups', 'media', 'starred'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => {
                  setType(tab);
                  if (tab === 'starred') void fetchStarredMessages();
                }}
                className={`px-3 py-1 rounded-full text-xs font-medium capitalize transition ${
                  type === tab
                    ? 'bg-[#00A884] text-white'
                    : 'bg-gray-100 dark:bg-[#2a3942] text-[#667781] dark:text-[#aebac1]'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-[#667781] dark:text-[#8696a0]">
            <Calendar className="w-3.5 h-3.5" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="px-2 py-1 rounded-lg bg-gray-100 dark:bg-[#111b21]"
            />
            <span>to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="px-2 py-1 rounded-lg bg-gray-100 dark:bg-[#111b21]"
            />
            <select
              value={conversationId}
              onChange={(e) => setConversationId(e.target.value)}
              className="px-2 py-1 rounded-lg bg-gray-100 dark:bg-[#111b21] max-w-[160px]"
            >
              <option value="">All Chats</option>
              {conversations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.group?.name || c.members?.[0]?.user?.displayName || c.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </div>
        </form>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading ? (
            <p className="text-center text-sm text-[#667781] py-8">Searching...</p>
          ) : type === 'starred' ? (
            <div className="space-y-2">
              {starredMessages.length === 0 ? (
                <p className="text-center text-sm text-[#667781] py-8">No starred messages yet</p>
              ) : (
                starredMessages.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      onSelectConversation(m.conversationId);
                      onClose();
                    }}
                    className="w-full text-left p-3 rounded-xl bg-gray-50 dark:bg-[#111b21] hover:bg-gray-100 dark:hover:bg-[#2a3942]"
                  >
                    <div className="flex items-center justify-between text-xs text-[#00A884] mb-1">
                      <span className="flex items-center gap-1">
                        <Star className="w-3 h-3 fill-amber-400 text-amber-400" /> Starred
                      </span>
                      <span className="text-[#667781]">
                        {new Date(m.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-sm truncate">{m.decryptedContent || m.content || m.messageType}</p>
                  </button>
                ))
              )}
            </div>
          ) : (
            <>
              {results.contacts.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase text-[#667781] mb-2">Contacts</h4>
                  <div className="space-y-1">
                    {results.contacts.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={async () => {
                          const conv = await createDirectChat(u.id);
                          onSelectConversation(conv.id);
                          onClose();
                        }}
                        className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-[#2a3942] text-left"
                      >
                        <Avatar src={u.avatarUrl} name={u.displayName} size="sm" />
                        <div>
                          <p className="text-sm font-medium">{u.displayName}</p>
                          <p className="text-xs text-[#667781]">{u.phoneNumber}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {results.groups.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase text-[#667781] mb-2">Groups</h4>
                  <div className="space-y-1">
                    {results.groups.map((g) => (
                      <div
                        key={g.id}
                        className="flex items-center gap-3 p-2 rounded-xl bg-gray-50 dark:bg-[#111b21]"
                      >
                        <Avatar src={g.avatarUrl} name={g.name} size="sm" isGroup />
                        <div>
                          <p className="text-sm font-medium">{g.name}</p>
                          <p className="text-xs text-[#667781] truncate">{g.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {results.messages.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase text-[#667781] mb-2 flex items-center gap-1">
                    <MessageSquare className="w-3.5 h-3.5" /> Messages
                  </h4>
                  <div className="space-y-1.5">
                    {results.messages.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          onSelectConversation(m.conversationId);
                          onClose();
                        }}
                        className="w-full text-left p-2.5 rounded-xl bg-gray-50 dark:bg-[#111b21] hover:bg-gray-100 dark:hover:bg-[#2a3942]"
                      >
                        <p className="text-sm">{m.decryptedContent || m.content}</p>
                        <p className="text-[11px] text-[#667781] mt-0.5">
                          {new Date(m.createdAt).toLocaleString()}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {results.media.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase text-[#667781] mb-2 flex items-center gap-1">
                    <ImageIcon className="w-3.5 h-3.5" /> Media
                  </h4>
                  <div className="grid grid-cols-3 gap-2">
                    {results.media.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          onSelectConversation(m.conversationId);
                          onClose();
                        }}
                        className="p-2 rounded-xl bg-gray-50 dark:bg-[#111b21] text-xs truncate"
                      >
                        {m.attachments?.[0]?.fileName || m.messageType}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {results.contacts.length === 0 &&
                results.groups.length === 0 &&
                results.messages.length === 0 &&
                results.media.length === 0 && (
                  <p className="text-center text-sm text-[#667781] py-8">
                    {query ? 'No matching results found' : 'Enter a keyword to search across your chats'}
                  </p>
                )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export const NewChatModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onChatCreated: (conversationId: string) => void;
}> = ({ open, onClose, onChatCreated }) => {
  const { searchUsers, contacts, fetchContacts, syncContacts, createDirectChat } = useChatStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [syncInput, setSyncInput] = useState('');
  const [showSync, setShowSync] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const handleSearch = async (val: string) => {
    setQuery(val);
    if (val.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const users = await searchUsers(val.trim(), val.trim().startsWith('+') ? 'phone' : 'username');
      setResults(users);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const startChat = async (userId: string) => {
    try {
      const conv = await createDirectChat(userId);
      onChatCreated(conv.id);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to start chat');
    }
  };

  const handleSync = async (e: React.FormEvent) => {
    e.preventDefault();
    const phones = syncInput
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (phones.length === 0) return;
    try {
      await syncContacts(phones);
      await fetchContacts();
      setShowSync(false);
      setSyncInput('');
      toast.success('Contacts synced!');
    } catch {
      toast.error('Failed to sync contacts');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-[#202c33] rounded-2xl max-w-md w-full shadow-xl border border-gray-200 dark:border-[#2a3942] overflow-hidden flex flex-col max-h-[80vh]">
        <div className="p-4 border-b border-gray-200 dark:border-[#2a3942] flex items-center justify-between">
          <h3 className="font-semibold text-base">New Chat</h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSync((s) => !s)}
              className="text-xs text-[#00A884] font-semibold flex items-center gap-1"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Sync
            </button>
            <button type="button" onClick={onClose}>
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>
        </div>

        {showSync && (
          <form onSubmit={handleSync} className="p-4 bg-gray-50 dark:bg-[#111b21] border-b border-gray-200 dark:border-[#2a3942] space-y-2">
            <textarea
              rows={2}
              value={syncInput}
              onChange={(e) => setSyncInput(e.target.value)}
              placeholder="Enter phone numbers separated by comma or newline (+15551234567, ...)"
              className="w-full p-2 rounded-lg bg-white dark:bg-[#202c33] border border-gray-300 dark:border-[#2a3942] text-xs"
            />
            <button
              type="submit"
              className="px-3 py-1.5 rounded-lg bg-[#00A884] text-white text-xs font-semibold"
            >
              Sync Contacts
            </button>
          </form>
        )}

        <div className="p-3 border-b border-gray-100 dark:border-[#2a3942]">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-100 dark:bg-[#111b21]">
            <Search className="w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => void handleSearch(e.target.value)}
              placeholder="Search username or +phone number..."
              className="flex-1 bg-transparent text-sm focus:outline-none"
              autoFocus
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loading && <p className="text-xs text-center py-4 text-[#667781]">Searching...</p>}

          {results.length > 0 && (
            <div>
              <p className="px-2 py-1 text-[11px] font-semibold uppercase text-[#667781]">
                Search Results
              </p>
              {results.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => void startChat(u.id)}
                  className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-100 dark:hover:bg-[#2a3942] text-left"
                >
                  <Avatar src={u.avatarUrl} name={u.displayName} size="sm" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{u.displayName}</p>
                    <p className="text-xs text-[#667781] truncate">
                      {u.username ? `@${u.username} · ` : ''}
                      {u.phoneNumber}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}

          <div>
            <p className="px-2 py-1 text-[11px] font-semibold uppercase text-[#667781]">
              Your Contacts ({contacts.length})
            </p>
            {contacts.length === 0 ? (
              <p className="text-xs text-[#667781] text-center py-6">
                Search for a user above or sync phone contacts to start chatting.
              </p>
            ) : (
              contacts.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => void startChat(c.contactId)}
                  className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-100 dark:hover:bg-[#2a3942] text-left"
                >
                  <Avatar
                    src={c.contactUser?.avatarUrl}
                    name={c.nickname || c.contactUser?.displayName || 'Contact'}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {c.nickname || c.contactUser?.displayName || c.contactId}
                    </p>
                    <p className="text-xs text-[#667781] truncate">{c.contactUser?.about}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export const CreateGroupModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onGroupCreated: (conversationId?: string) => void;
}> = ({ open, onClose, onGroupCreated }) => {
  const { contacts, searchUsers, fetchConversations } = useChatStore();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [searchQ, setSearchQ] = useState('');
  const [searchRes, setSearchRes] = useState<User[]>([]);
  const [creating, setCreating] = useState(false);

  if (!open) return null;

  const toggleUser = (u: User) => {
    setSelectedUsers((prev) =>
      prev.some((x) => x.id === u.id) ? prev.filter((x) => x.id !== u.id) : [...prev, u],
    );
  };

  const handleSearch = async (q: string) => {
    setSearchQ(q);
    if (q.trim().length < 2) {
      setSearchRes([]);
      return;
    }
    try {
      const res = await searchUsers(q.trim(), q.trim().startsWith('+') ? 'phone' : 'username');
      setSearchRes(res);
    } catch {
      setSearchRes([]);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const up = await mediaApi.uploadFile(file, 'groups');
      setAvatarUrl(up.url);
    } catch {
      toast.error('Failed to upload group icon');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Group name is required');
      return;
    }
    setCreating(true);
    try {
      const created = await groupsApi.createGroup({
        name: name.trim(),
        description: description.trim() || undefined,
        avatarUrl: avatarUrl || undefined,
        memberIds: selectedUsers.map((u) => u.id),
      });
      await fetchConversations();
      toast.success(`Group "${created.name}" created!`);
      onGroupCreated(created.conversationId);
      onClose();
      setName('');
      setDescription('');
      setSelectedUsers([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create group');
    } finally {
      setCreating(false);
    }
  };

  const candidateList: User[] = [
    ...searchRes,
    ...contacts
      .map((c) => c.contactUser)
      .filter((u): u is User => Boolean(u && !searchRes.some((s) => s.id === u.id))),
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-[#202c33] rounded-2xl max-w-md w-full shadow-xl border border-gray-200 dark:border-[#2a3942] overflow-hidden flex flex-col max-h-[85vh]"
      >
        <div className="p-4 border-b border-gray-200 dark:border-[#2a3942] flex items-center justify-between">
          <h3 className="font-semibold text-base flex items-center gap-2">
            <Users className="w-5 h-5 text-[#00A884]" /> New Group
          </h3>
          <button type="button" onClick={onClose}>
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto flex-1">
          <div className="flex items-center gap-3">
            <label className="cursor-pointer shrink-0">
              <Avatar src={avatarUrl} name={name || 'G'} size="lg" isGroup />
              <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
            </label>
            <div className="flex-1 space-y-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Group subject *"
                className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-sm"
                required
              />
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description (optional)"
                className="w-full px-3 py-1.5 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-xs"
              />
            </div>
          </div>

          {selectedUsers.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedUsers.map((u) => (
                <span
                  key={u.id}
                  onClick={() => toggleUser(u)}
                  className="px-2.5 py-1 rounded-full bg-[#00A884]/15 text-[#00A884] text-xs font-medium flex items-center gap-1 cursor-pointer"
                >
                  {u.displayName} <X className="w-3 h-3" />
                </span>
              ))}
            </div>
          )}

          <input
            type="text"
            value={searchQ}
            onChange={(e) => void handleSearch(e.target.value)}
            placeholder="Search people to add..."
            className="w-full px-3 py-2 rounded-xl bg-gray-100 dark:bg-[#111b21] text-xs focus:outline-none"
          />

          <div className="max-h-48 overflow-y-auto space-y-1">
            {candidateList.map((u) => {
              const selected = selectedUsers.some((x) => x.id === u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => toggleUser(u)}
                  className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-[#2a3942] text-left"
                >
                  <div className="flex items-center gap-2.5">
                    <Avatar src={u.avatarUrl} name={u.displayName} size="sm" />
                    <div>
                      <p className="text-xs font-medium">{u.displayName}</p>
                      <p className="text-[11px] text-[#667781]">{u.phoneNumber}</p>
                    </div>
                  </div>
                  <div
                    className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                      selected ? 'bg-[#00A884] border-[#00A884] text-white' : 'border-gray-300'
                    }`}
                  >
                    {selected && <Check className="w-3 h-3" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="p-4 border-t border-gray-200 dark:border-[#2a3942] flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-[#2a3942]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={creating}
            className="px-4 py-2 rounded-lg text-sm bg-[#00A884] text-white font-semibold disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Create Group'}
          </button>
        </div>
      </form>
    </div>
  );
};

export const ForwardModal: React.FC<{
  message: LocalMessage | null;
  conversations: ConversationWithMeta[];
  currentUserId: string;
  onClose: () => void;
}> = ({ message, conversations, currentUserId, onClose }) => {
  const { forwardMessage } = useChatStore();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  if (!message) return null;

  const toggle = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleForward = async () => {
    if (selectedIds.length === 0) return;
    setSending(true);
    try {
      await forwardMessage(message.id, selectedIds);
      toast.success(`Forwarded to ${selectedIds.length} chat(s)`);
      onClose();
    } catch {
      toast.error('Failed to forward message');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-[#202c33] rounded-2xl max-w-md w-full shadow-xl border border-gray-200 dark:border-[#2a3942] overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-[#2a3942] flex items-center justify-between">
          <h3 className="font-semibold text-base flex items-center gap-2">
            <Forward className="w-4 h-4 text-[#00A884]" /> Forward message to...
          </h3>
          <button type="button" onClick={onClose}>
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>
        <div className="max-h-72 overflow-y-auto p-2 space-y-1">
          {conversations.map((c) => {
            const isGroup = c.type === ConversationType.GROUP;
            const other = !isGroup ? c.members?.find((m) => m.userId !== currentUserId)?.user : undefined;
            const label = isGroup ? c.group?.name || 'Group' : other?.displayName || 'Chat';
            const checked = selectedIds.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggle(c.id)}
                className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-gray-100 dark:hover:bg-[#2a3942]"
              >
                <div className="flex items-center gap-3">
                  <Avatar
                    src={isGroup ? c.group?.avatarUrl : other?.avatarUrl}
                    name={label}
                    size="sm"
                    isGroup={isGroup}
                  />
                  <span className="text-sm font-medium">{label}</span>
                </div>
                <div
                  className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                    checked ? 'bg-[#00A884] border-[#00A884] text-white' : 'border-gray-300'
                  }`}
                >
                  {checked && <Check className="w-3 h-3" />}
                </div>
              </button>
            );
          })}
        </div>
        <div className="p-4 border-t border-gray-200 dark:border-[#2a3942] flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-[#2a3942]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={selectedIds.length === 0 || sending}
            onClick={() => void handleForward()}
            className="px-4 py-2 rounded-lg text-sm bg-[#00A884] text-white font-semibold disabled:opacity-50"
          >
            {sending ? 'Sending...' : `Forward (${selectedIds.length})`}
          </button>
        </div>
      </div>
    </div>
  );
};

export const MessageInfoModal: React.FC<{
  message: LocalMessage | null;
  onClose: () => void;
}> = ({ message, onClose }) => {
  if (!message) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-[#202c33] rounded-2xl max-w-md w-full p-6 shadow-xl border border-gray-200 dark:border-[#2a3942]">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-base">Message Info</h3>
          <button type="button" onClick={onClose}>
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="p-3 rounded-xl bg-[#d9fdd3] dark:bg-[#005c4b] text-sm mb-4">
          {message.decryptedContent || message.content || message.messageType}
        </div>

        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-[#667781] dark:text-[#8696a0]">
              <Check className="w-4 h-4" /> Sent
            </span>
            <span className="font-mono text-xs">
              {new Date(message.sentAt || message.createdAt).toLocaleString()}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-[#667781] dark:text-[#8696a0]">
              <CheckCheck className="w-4 h-4" /> Delivered
            </span>
            <span className="font-mono text-xs">
              {message.deliveredAt ? new Date(message.deliveredAt).toLocaleString() : 'Pending'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-[#53bdeb]">
              <CheckCheck className="w-4 h-4" /> Read
            </span>
            <span className="font-mono text-xs">
              {message.readAt ? new Date(message.readAt).toLocaleString() : 'Not yet read'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import {
  Search,
  X,
  Users,
  UserPlus,
  Trash2,
  Phone,
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
import { COUNTRIES } from '@/lib/countries';
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
  initialMode?: 'chat' | 'add_contact';
}> = ({ open, onClose, onChatCreated, initialMode = 'chat' }) => {
  const {
    searchUsers,
    contacts,
    fetchContacts,
    addContact,
    removeContact,
    syncContacts,
    createDirectChat,
  } = useChatStore();
  const [mode, setMode] = useState<'chat' | 'add_contact' | 'sync'>(initialMode);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [dialCode, setDialCode] = useState('+1');
  const [phoneInput, setPhoneInput] = useState('');
  const [nicknameInput, setNicknameInput] = useState('');
  const [addError, setAddError] = useState('');
  const [savingContact, setSavingContact] = useState(false);
  const [syncInput, setSyncInput] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setAddError('');
    void fetchContacts();
  }, [open, initialMode, fetchContacts]);

  if (!open) return null;

  const isSavedContact = (userId: string) =>
    contacts.some((c) => c.contactId === userId || c.contactUser?.id === userId);

  const normalizeE164 = (rawPhone: string): string => {
    const cleaned = rawPhone.trim().replace(/[\s\-().]/g, '');
    if (cleaned.startsWith('+')) return cleaned;
    const digitsOnly = cleaned.replace(/\D/g, '');
    return `${dialCode}${digitsOnly}`;
  };

  const handleSearch = async (val: string) => {
    setQuery(val);
    if (val.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const users = await searchUsers(val.trim());
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

  const submitAddContact = async (startChatAfter: boolean) => {
    setAddError('');
    const e164 = normalizeE164(phoneInput);
    if (!/^\+[1-9]\d{6,14}$/.test(e164)) {
      const msg = 'Enter a valid phone number in international format (e.g. +15551234567).';
      setAddError(msg);
      return;
    }

    setSavingContact(true);
    try {
      const saved = await addContact(e164, nicknameInput.trim() || undefined);
      setPhoneInput('');
      setNicknameInput('');
      toast.success('Contact added!');
      if (startChatAfter) {
        await startChat(saved.contactId);
      } else {
        setMode('chat');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add contact';
      setAddError(msg);
      toast.error(msg);
    } finally {
      setSavingContact(false);
    }
  };

  const handleQuickAdd = async (u: User) => {
    try {
      await addContact(u.phoneNumber, u.displayName);
      toast.success(`Added ${u.displayName} to contacts`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add contact');
    }
  };

  const handleRemoveContact = async (contactId: string, label: string) => {
    try {
      await removeContact(contactId);
      toast.success(`Removed ${label} from contacts`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove contact');
    }
  };

  const handleSync = async (e: React.FormEvent) => {
    e.preventDefault();
    const phones = syncInput
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (phones.length === 0) return;
    setSyncing(true);
    try {
      const synced = await syncContacts(phones);
      setSyncInput('');
      setMode('chat');
      if (synced.length === 0) {
        toast.warning('No registered WhatsApp Pro users matched those phone numbers.');
      } else {
        toast.success(`Synced ${synced.length} contact${synced.length === 1 ? '' : 's'}!`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to sync contacts');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-[#202c33] rounded-2xl max-w-md w-full shadow-xl border border-gray-200 dark:border-[#2a3942] overflow-hidden flex flex-col max-h-[85vh]">
        <div className="p-4 border-b border-gray-200 dark:border-[#2a3942] flex items-center justify-between gap-2">
          <h3 className="font-semibold text-base">Contacts & New Chat</h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setAddError('');
                setMode((m) => (m === 'add_contact' ? 'chat' : 'add_contact'));
              }}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${
                mode === 'add_contact'
                  ? 'bg-[#00A884] text-white'
                  : 'bg-[#00A884]/15 text-[#00A884] hover:bg-[#00A884]/25'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" /> Add Contact
            </button>
            <button
              type="button"
              onClick={() => setMode((m) => (m === 'sync' ? 'chat' : 'sync'))}
              className={`px-2 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${
                mode === 'sync'
                  ? 'bg-gray-200 dark:bg-[#2a3942] text-[#111b21] dark:text-[#e9edef]'
                  : 'text-[#667781] hover:bg-gray-100 dark:hover:bg-[#2a3942]'
              }`}
              title="Bulk Sync Phone Numbers"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Sync
            </button>
            <button type="button" onClick={onClose} aria-label="Close">
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>
        </div>

        {mode === 'add_contact' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitAddContact(false);
            }}
            className="p-4 bg-gray-50 dark:bg-[#111b21] border-b border-gray-200 dark:border-[#2a3942] space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-[#00A884] flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5" /> Add Contact by Phone
              </span>
              <button
                type="button"
                onClick={() => setMode('chat')}
                className="text-xs text-[#667781] hover:underline"
              >
                Cancel
              </button>
            </div>

            <div className="flex gap-2">
              <select
                value={dialCode}
                onChange={(e) => setDialCode(e.target.value)}
                aria-label="Country code"
                className="w-28 px-2 py-2 rounded-xl bg-white dark:bg-[#202c33] border border-gray-300 dark:border-[#2a3942] text-xs focus:outline-none focus:border-[#00A884]"
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.dialCode}>
                    {c.flag} {c.dialCode}
                  </option>
                ))}
              </select>
              <input
                type="tel"
                value={phoneInput}
                onChange={(e) => {
                  setPhoneInput(e.target.value);
                  if (addError) setAddError('');
                }}
                placeholder="Phone digits or +15551234567"
                className="flex-1 px-3 py-2 rounded-xl bg-white dark:bg-[#202c33] border border-gray-300 dark:border-[#2a3942] text-sm focus:outline-none focus:border-[#00A884]"
                autoFocus
                required
              />
            </div>

            <input
              type="text"
              value={nicknameInput}
              onChange={(e) => setNicknameInput(e.target.value)}
              placeholder="Contact name / nickname (optional)"
              maxLength={100}
              className="w-full px-3 py-2 rounded-xl bg-white dark:bg-[#202c33] border border-gray-300 dark:border-[#2a3942] text-sm focus:outline-none focus:border-[#00A884]"
            />

            {addError && (
              <p className="text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {addError}
              </p>
            )}

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={savingContact}
                className="flex-1 py-2 rounded-xl border border-[#00A884] text-[#00A884] hover:bg-[#00A884]/10 text-xs font-semibold disabled:opacity-50 transition"
              >
                {savingContact ? 'Saving...' : 'Save Contact'}
              </button>
              <button
                type="button"
                disabled={savingContact}
                onClick={() => void submitAddContact(true)}
                className="flex-1 py-2 rounded-xl bg-[#00A884] hover:bg-[#008f6f] text-white text-xs font-semibold disabled:opacity-50 transition"
              >
                {savingContact ? 'Saving...' : 'Save & Start Chat'}
              </button>
            </div>
          </form>
        )}

        {mode === 'sync' && (
          <form onSubmit={handleSync} className="p-4 bg-gray-50 dark:bg-[#111b21] border-b border-gray-200 dark:border-[#2a3942] space-y-2">
            <textarea
              rows={2}
              value={syncInput}
              onChange={(e) => setSyncInput(e.target.value)}
              placeholder="Bulk sync E.164 phone numbers separated by comma or newline (+15551234567, ...)"
              className="w-full p-2 rounded-lg bg-white dark:bg-[#202c33] border border-gray-300 dark:border-[#2a3942] text-xs"
            />
            <div className="flex items-center justify-between gap-2">
              <button
                type="submit"
                disabled={syncing}
                className="px-3 py-1.5 rounded-lg bg-[#00A884] text-white text-xs font-semibold disabled:opacity-50"
              >
                {syncing ? 'Syncing...' : 'Sync Numbers'}
              </button>
              <button
                type="button"
                onClick={() => setMode('chat')}
                className="text-xs text-[#667781] hover:underline"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        <div className="p-3 border-b border-gray-100 dark:border-[#2a3942]">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-100 dark:bg-[#111b21]">
            <Search className="w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => void handleSearch(e.target.value)}
              placeholder="Search by name, @username, or phone..."
              className="flex-1 bg-transparent text-sm focus:outline-none"
              autoFocus={mode === 'chat'}
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setResults([]);
                }}
              >
                <X className="w-4 h-4 text-gray-400" />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {loading && <p className="text-xs text-center py-4 text-[#667781]">Searching...</p>}

          {results.length > 0 && (
            <div>
              <p className="px-2 py-1 text-[11px] font-semibold uppercase text-[#667781]">
                Search Results
              </p>
              {results.map((u) => {
                const saved = isSavedContact(u.id);
                return (
                  <div
                    key={u.id}
                    className="w-full flex items-center gap-2 p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-[#2a3942]"
                  >
                    <button
                      type="button"
                      onClick={() => void startChat(u.id)}
                      className="flex-1 min-w-0 flex items-center gap-3 text-left"
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
                    {saved ? (
                      <span className="px-2 py-1 rounded-lg bg-[#00A884]/10 text-[#00A884] text-[11px] font-medium shrink-0">
                        Saved
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleQuickAdd(u)}
                        className="px-2.5 py-1 rounded-lg bg-[#00A884]/15 hover:bg-[#00A884]/25 text-[#00A884] text-xs font-semibold flex items-center gap-1 shrink-0"
                        title="Save to Contacts"
                      >
                        <UserPlus className="w-3.5 h-3.5" /> Add
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!loading && query.trim().length >= 2 && results.length === 0 && (
            <p className="text-xs text-[#667781] text-center py-3">
              No users matched "{query.trim()}". Try adding them directly by phone number.
            </p>
          )}

          <div>
            <p className="px-2 py-1 text-[11px] font-semibold uppercase text-[#667781]">
              Your Contacts ({contacts.length})
            </p>
            {contacts.length === 0 ? (
              <div className="text-xs text-[#667781] text-center py-6 space-y-2">
                <p>No saved contacts yet. Add a contact by phone or search registered users above.</p>
                {mode !== 'add_contact' && (
                  <button
                    type="button"
                    onClick={() => setMode('add_contact')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#00A884]/15 text-[#00A884] font-semibold"
                  >
                    <UserPlus className="w-3.5 h-3.5" /> Add First Contact
                  </button>
                )}
              </div>
            ) : (
              contacts.map((c) => {
                const label = c.nickname || c.contactUser?.displayName || c.contactId;
                return (
                  <div
                    key={c.id}
                    className="w-full flex items-center gap-2 p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-[#2a3942] group"
                  >
                    <button
                      type="button"
                      onClick={() => void startChat(c.contactId)}
                      className="flex-1 min-w-0 flex items-center gap-3 text-left"
                    >
                      <Avatar
                        src={c.contactUser?.avatarUrl}
                        name={label}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{label}</p>
                        <p className="text-xs text-[#667781] truncate">
                          {c.contactUser?.phoneNumber || c.contactUser?.about || ''}
                        </p>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRemoveContact(c.contactId, label)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-500/10 opacity-70 group-hover:opacity-100 transition shrink-0"
                      title="Remove contact"
                      aria-label={`Remove ${label}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })
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
  const { contacts, searchUsers, fetchContacts, fetchConversations } = useChatStore();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [searchQ, setSearchQ] = useState('');
  const [searchRes, setSearchRes] = useState<User[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open) {
      void fetchContacts();
    }
  }, [open, fetchContacts]);

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
      const res = await searchUsers(q.trim());
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

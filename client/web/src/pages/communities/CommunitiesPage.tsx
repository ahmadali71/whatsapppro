import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users,
  Plus,
  X,
  Trash2,
  Link2,
  FolderPlus,
  Camera,
  UserPlus,
  Copy,
  Megaphone,
  Search,
} from 'lucide-react';
import { ConversationType, MemberRole, User } from '@whatsapp-pro/shared-types';
import { communitiesApi, CommunityWithGroups, mediaApi } from '@/services/api.services';
import { useAuthStore } from '@/stores/authStore';
import { useChatStore } from '@/stores/chatStore';
import { extractErrorMessage } from '@/lib/api';
import { Avatar } from '@/components/common/Avatar';
import { ImageCropModal } from '@/components/common/ImageCropModal';
import { toast } from '@/stores/toastStore';

export const CommunitiesPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { conversations, setActiveConversation, fetchConversations, searchUsers } = useChatStore();

  const [communities, setCommunities] = useState<CommunityWithGroups[]>([]);
  const [selected, setSelected] = useState<CommunityWithGroups | null>(null);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [createAvatarUrl, setCreateAvatarUrl] = useState('');
  const [creating, setCreating] = useState(false);

  const [cropFile, setCropFile] = useState<File | null>(null);
  const [cropTarget, setCropTarget] = useState<'create' | 'edit'>('create');

  const [linkGroupModalOpen, setLinkGroupModalOpen] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [memberQuery, setMemberQuery] = useState('');
  const [memberResults, setMemberResults] = useState<User[]>([]);
  const [searchingMembers, setSearchingMembers] = useState(false);

  const loadCommunities = async () => {
    setLoading(true);
    try {
      const list = await communitiesApi.listCommunities();
      setCommunities(list);
      setSelected((prev) => {
        if (!prev) return null;
        return list.find((c) => c.id === prev.id) || prev;
      });
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to load communities'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCommunities();
  }, []);

  const refreshSelected = async (communityId: string) => {
    try {
      const updated = await communitiesApi.getCommunity(communityId);
      setSelected(updated);
      setCommunities((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to load community details'));
    }
  };

  const handleCropConfirm = async (croppedBlob: Blob) => {
    setCropFile(null);
    try {
      const up = await mediaApi.uploadFile(
        croppedBlob,
        'communities',
        undefined,
        'community-icon.jpg',
      );
      if (cropTarget === 'create') {
        setCreateAvatarUrl(up.url);
        toast.success('Community icon ready');
      } else if (selected) {
        const updated = await communitiesApi.updateCommunity(selected.id, { avatarUrl: up.url });
        setSelected((prev) => (prev ? { ...prev, ...updated, avatarUrl: up.url } : updated));
        setCommunities((prev) =>
          prev.map((c) => (c.id === selected.id ? { ...c, avatarUrl: up.url } : c)),
        );
        toast.success('Community icon updated');
      }
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to upload community icon'));
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const created = await communitiesApi.createCommunity({
        name: name.trim(),
        description: description.trim() || undefined,
        avatarUrl: createAvatarUrl || undefined,
      });
      setCreateOpen(false);
      setName('');
      setDescription('');
      setCreateAvatarUrl('');
      await loadCommunities();
      setSelected(created);
      void fetchConversations({ silent: true });
      toast.success('Community created!');
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to create community'));
    } finally {
      setCreating(false);
    }
  };

  const handleLinkGroup = async (groupId: string) => {
    if (!selected) return;
    try {
      await communitiesApi.addGroup(selected.id, groupId);
      await refreshSelected(selected.id);
      setLinkGroupModalOpen(false);
      toast.success('Group added to community');
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to link group'));
    }
  };

  const handleUnlinkGroup = async (groupId: string) => {
    if (!selected) return;
    try {
      await communitiesApi.removeGroup(selected.id, groupId);
      await refreshSelected(selected.id);
      toast.success('Group removed from community');
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to remove group'));
    }
  };

  const handleDeleteCommunity = async (id: string) => {
    try {
      await communitiesApi.deleteCommunity(id);
      setSelected(null);
      await loadCommunities();
      toast.success('Community deleted');
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to delete community'));
    }
  };

  const handleMemberSearch = async (q: string) => {
    setMemberQuery(q);
    if (q.trim().length < 2) {
      setMemberResults([]);
      return;
    }
    setSearchingMembers(true);
    try {
      const users = await searchUsers(q.trim());
      setMemberResults(users);
    } catch {
      setMemberResults([]);
    } finally {
      setSearchingMembers(false);
    }
  };

  const handleAddMember = async (targetUserId: string) => {
    if (!selected) return;
    try {
      await communitiesApi.addMembers(selected.id, [targetUserId]);
      await refreshSelected(selected.id);
      toast.success('Member added to community');
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to add member'));
    }
  };

  const handleRemoveMember = async (targetUserId: string) => {
    if (!selected) return;
    try {
      await communitiesApi.removeMember(selected.id, targetUserId);
      await refreshSelected(selected.id);
      toast.success('Member removed from community');
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to remove member'));
    }
  };

  const handleCopyInviteLink = async (inviteCode: string) => {
    const url = `${window.location.origin}/join/${inviteCode}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Invite link copied to clipboard');
    } catch {
      toast.info(url);
    }
  };

  const openConversation = (conversationId?: string | null) => {
    if (!conversationId) {
      toast.error('Conversation is unavailable right now');
      return;
    }
    setActiveConversation(conversationId);
    navigate('/');
  };

  const availableGroups = conversations
    .filter((c) => c.type === ConversationType.GROUP && c.group)
    .map((c) => c.group!);

  const myCommunityRole = selected?.members?.find((m) => m.userId === user?.id)?.role;
  const isCommunityAdmin =
    selected?.createdBy === user?.id ||
    myCommunityRole === MemberRole.OWNER ||
    myCommunityRole === MemberRole.ADMIN;

  return (
    <div className="flex-1 flex flex-col md:flex-row h-full overflow-hidden bg-white dark:bg-[#111b21]">
      {/* Left List */}
      <section className="w-full md:w-[360px] border-r border-gray-200 dark:border-[#2a3942] flex flex-col h-full">
        <div className="h-14 px-4 bg-[#f0f2f5] dark:bg-[#202c33] border-b border-gray-200 dark:border-[#2a3942] flex items-center justify-between">
          <h1 className="text-lg font-bold">Communities</h1>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-[#2a3942] text-[#00A884]"
            title="New Community"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading ? (
            <p className="text-xs text-[#667781] p-4">Loading communities...</p>
          ) : communities.length === 0 ? (
            <div className="p-8 text-center">
              <Users className="w-12 h-12 mx-auto mb-3 text-[#00A884] opacity-70" />
              <p className="text-sm font-medium mb-1">Stay connected with a community</p>
              <p className="text-xs text-[#667781] dark:text-[#8696a0] mb-4">
                Bring members together in topic-based groups and easily send announcements.
              </p>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="px-4 py-2 rounded-full bg-[#00A884] text-white text-xs font-semibold"
              >
                Start your community
              </button>
            </div>
          ) : (
            communities.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setSelected(c);
                  void refreshSelected(c.id);
                }}
                className={`w-full flex items-center gap-3 p-3 rounded-2xl text-left transition ${
                  selected?.id === c.id
                    ? 'bg-[#f0f2f5] dark:bg-[#2a3942]'
                    : 'hover:bg-[#f5f6f6] dark:hover:bg-[#202c33]'
                }`}
              >
                <Avatar src={c.avatarUrl} name={c.name} size="md" isGroup />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm truncate">{c.name}</p>
                  <p className="text-xs text-[#667781] dark:text-[#8696a0] truncate">
                    {c.description || `${c.groups?.length || 0} linked groups`}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      {/* Detail View */}
      <section className="flex-1 flex flex-col bg-[#f0f2f5] dark:bg-[#0b141a] overflow-y-auto p-6">
        {selected ? (
          <div className="max-w-2xl w-full mx-auto space-y-5">
            <div className="bg-white dark:bg-[#202c33] rounded-2xl p-6 flex flex-wrap items-center justify-between gap-4 shadow-sm">
              <div className="flex items-center gap-4">
                {isCommunityAdmin ? (
                  <label className="relative cursor-pointer group shrink-0">
                    <Avatar src={selected.avatarUrl} name={selected.name} size="lg" isGroup />
                    <span className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-[#00A884] text-white flex items-center justify-center shadow">
                      <Camera className="w-3.5 h-3.5" />
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (f) {
                          setCropTarget('edit');
                          setCropFile(f);
                        }
                      }}
                      className="hidden"
                    />
                  </label>
                ) : (
                  <Avatar src={selected.avatarUrl} name={selected.name} size="lg" isGroup />
                )}
                <div>
                  <h2 className="text-xl font-bold">{selected.name}</h2>
                  <p className="text-sm text-[#667781] dark:text-[#8696a0]">
                    {selected.description || 'Community hub'}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {selected.announcementConversationId && (
                  <button
                    type="button"
                    onClick={() => openConversation(selected.announcementConversationId)}
                    className="px-3.5 py-2 rounded-xl bg-[#00A884]/15 text-[#00A884] hover:bg-[#00A884]/25 text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Megaphone className="w-4 h-4" /> Open Announcements
                  </button>
                )}
                {selected.inviteLink && (
                  <button
                    type="button"
                    onClick={() => void handleCopyInviteLink(selected.inviteLink!)}
                    className="px-3 py-2 rounded-xl border border-gray-200 dark:border-[#2a3942] hover:bg-gray-100 dark:hover:bg-[#2a3942] text-xs font-semibold flex items-center gap-1.5"
                    title="Copy Community Invite Link"
                  >
                    <Copy className="w-3.5 h-3.5" /> Invite Link
                  </button>
                )}
                {isCommunityAdmin && (
                  <button
                    type="button"
                    onClick={() => setLinkGroupModalOpen(true)}
                    className="px-3.5 py-2 rounded-xl bg-[#00A884] text-white text-xs font-semibold flex items-center gap-1.5"
                  >
                    <FolderPlus className="w-4 h-4" /> Add Group
                  </button>
                )}
                {isCommunityAdmin && (
                  <button
                    type="button"
                    onClick={() => void handleDeleteCommunity(selected.id)}
                    className="p-2 rounded-xl text-red-500 hover:bg-red-500/10"
                    title="Delete Community"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Linked Groups */}
            <div className="bg-white dark:bg-[#202c33] rounded-2xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold mb-3">
                Groups in this Community ({selected.groups?.length || 0})
              </h3>
              {!selected.groups || selected.groups.length === 0 ? (
                <p className="text-xs text-[#667781] py-4">
                  No groups linked yet. Click "Add Group" to organize existing groups under this community.
                </p>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-[#2a3942]">
                  {selected.groups.map((g) => {
                    const convId =
                      g.conversations?.[0]?.id ||
                      conversations.find((c) => c.groupId === g.id)?.id;
                    return (
                      <div key={g.id} className="py-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <Avatar src={g.avatarUrl} name={g.name} size="sm" isGroup />
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{g.name}</p>
                            <p className="text-xs text-[#667781] truncate">{g.description}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <button
                            type="button"
                            onClick={() => openConversation(convId)}
                            className="text-xs text-[#00A884] font-semibold hover:underline"
                          >
                            Open
                          </button>
                          {isCommunityAdmin && (
                            <button
                              type="button"
                              onClick={() => void handleUnlinkGroup(g.id)}
                              className="text-xs text-red-500 hover:underline"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Community Members */}
            <div className="bg-white dark:bg-[#202c33] rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">
                  Members ({selected.members?.length || 0})
                </h3>
                {isCommunityAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      setMemberQuery('');
                      setMemberResults([]);
                      setAddMemberOpen(true);
                    }}
                    className="px-3 py-1.5 rounded-xl bg-[#00A884]/15 text-[#00A884] text-xs font-semibold flex items-center gap-1.5"
                  >
                    <UserPlus className="w-3.5 h-3.5" /> Add Member
                  </button>
                )}
              </div>
              {!selected.members || selected.members.length === 0 ? (
                <p className="text-xs text-[#667781] py-3">No active members found.</p>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-[#2a3942]">
                  {selected.members.map((m) => (
                    <div key={m.id} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar
                          src={m.user?.avatarUrl}
                          name={m.user?.displayName || m.userId}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {m.user?.displayName || m.userId}
                            {m.userId === user?.id ? ' (You)' : ''}
                          </p>
                          <p className="text-xs text-[#667781] truncate">
                            {m.role}
                            {m.user?.phoneNumber ? ` · ${m.user.phoneNumber}` : ''}
                          </p>
                        </div>
                      </div>
                      {(isCommunityAdmin || m.userId === user?.id) &&
                        m.role !== MemberRole.OWNER && (
                          <button
                            type="button"
                            onClick={() => void handleRemoveMember(m.userId)}
                            className="text-xs text-red-500 hover:underline shrink-0"
                          >
                            {m.userId === user?.id ? 'Leave' : 'Remove'}
                          </button>
                        )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <Users className="w-14 h-14 text-[#00A884] mb-3 opacity-80" />
            <h2 className="text-lg font-semibold">Select a Community</h2>
            <p className="text-xs text-[#667781] max-w-sm mt-1">
              Manage linked topic groups and community members from one place.
            </p>
          </div>
        )}
      </section>

      {/* Create Community Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handleCreate}
            className="bg-white dark:bg-[#202c33] rounded-2xl max-w-md w-full p-6 shadow-xl border border-gray-200 dark:border-[#2a3942]"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-base">New Community</h3>
              <button type="button" onClick={() => setCreateOpen(false)}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <div className="flex justify-center mb-4">
              <label className="relative cursor-pointer group">
                <Avatar src={createAvatarUrl} name={name || 'C'} size="lg" isGroup />
                <span className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-[#00A884] text-white flex items-center justify-center shadow">
                  <Camera className="w-3.5 h-3.5" />
                </span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) {
                      setCropTarget('create');
                      setCropFile(f);
                    }
                  }}
                  className="hidden"
                />
              </label>
            </div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Community name *"
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-sm mb-3"
              required
            />
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this community about?"
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-sm mb-4"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="px-4 py-2 rounded-lg text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating}
                className="px-4 py-2 rounded-lg text-sm bg-[#00A884] text-white font-semibold disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Link Group Modal */}
      {linkGroupModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-[#202c33] rounded-2xl max-w-md w-full p-6 shadow-xl border border-gray-200 dark:border-[#2a3942]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-base flex items-center gap-2">
                <Link2 className="w-4 h-4 text-[#00A884]" /> Link Group to Community
              </h3>
              <button type="button" onClick={() => setLinkGroupModalOpen(false)}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {availableGroups.length === 0 ? (
                <p className="text-xs text-[#667781] text-center py-4">No groups available</p>
              ) : (
                availableGroups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => void handleLinkGroup(g.id)}
                    className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-gray-100 dark:hover:bg-[#2a3942] text-left"
                  >
                    <div className="flex items-center gap-2.5">
                      <Avatar src={g.avatarUrl} name={g.name} size="sm" isGroup />
                      <span className="text-sm font-medium">{g.name}</span>
                    </div>
                    <span className="text-xs text-[#00A884] font-semibold">Add</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Member Modal */}
      {addMemberOpen && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-[#202c33] rounded-2xl max-w-md w-full p-6 shadow-xl border border-gray-200 dark:border-[#2a3942]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-base flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-[#00A884]" /> Add Community Member
              </h3>
              <button type="button" onClick={() => setAddMemberOpen(false)}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-100 dark:bg-[#111b21] mb-3">
              <Search className="w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={memberQuery}
                onChange={(e) => void handleMemberSearch(e.target.value)}
                placeholder="Search by name, @username, or phone..."
                className="flex-1 bg-transparent text-sm focus:outline-none"
                autoFocus
              />
            </div>
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {searchingMembers && (
                <p className="text-xs text-[#667781] text-center py-4">Searching...</p>
              )}
              {!searchingMembers && memberQuery.trim().length >= 2 && memberResults.length === 0 && (
                <p className="text-xs text-[#667781] text-center py-4">No users found</p>
              )}
              {memberResults.map((u) => {
                const alreadyMember = selected.members?.some((m) => m.userId === u.id);
                return (
                  <div
                    key={u.id}
                    className="flex items-center justify-between p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-[#2a3942]"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar src={u.avatarUrl} name={u.displayName} size="sm" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{u.displayName}</p>
                        <p className="text-xs text-[#667781] truncate">
                          {u.username ? `@${u.username} · ` : ''}
                          {u.phoneNumber}
                        </p>
                      </div>
                    </div>
                    {alreadyMember ? (
                      <span className="text-xs text-[#667781] shrink-0">Member</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleAddMember(u.id)}
                        className="px-3 py-1 rounded-lg bg-[#00A884] text-white text-xs font-semibold shrink-0"
                      >
                        Add
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <ImageCropModal
        file={cropFile}
        shape="circle"
        title="Crop Community Icon"
        onCancel={() => setCropFile(null)}
        onConfirm={(blob) => void handleCropConfirm(blob)}
      />
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import { Users, Plus, X, Trash2, Link2, FolderPlus } from 'lucide-react';
import { ConversationType } from '@whatsapp-pro/shared-types';
import { communitiesApi, CommunityWithGroups } from '@/services/api.services';
import { useChatStore } from '@/stores/chatStore';
import { Avatar } from '@/components/common/Avatar';
import { toast } from '@/stores/toastStore';

export const CommunitiesPage: React.FC = () => {
  const { conversations, setActiveConversation } = useChatStore();
  const [communities, setCommunities] = useState<CommunityWithGroups[]>([]);
  const [selected, setSelected] = useState<CommunityWithGroups | null>(null);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const [linkGroupModalOpen, setLinkGroupModalOpen] = useState(false);

  const loadCommunities = async () => {
    setLoading(true);
    try {
      const list = await communitiesApi.listCommunities();
      setCommunities(list);
      if (selected) {
        const refreshed = list.find((c) => c.id === selected.id);
        if (refreshed) setSelected(refreshed);
      }
    } catch {
      // Ignore if backend returns empty
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCommunities();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const created = await communitiesApi.createCommunity({
        name: name.trim(),
        description: description.trim() || undefined,
      });
      setCreateOpen(false);
      setName('');
      setDescription('');
      await loadCommunities();
      setSelected(created);
      toast.success('Community created!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create community');
    } finally {
      setCreating(false);
    }
  };

  const handleLinkGroup = async (groupId: string) => {
    if (!selected) return;
    try {
      await communitiesApi.addGroup(selected.id, groupId);
      const updated = await communitiesApi.getCommunity(selected.id);
      setSelected(updated);
      setLinkGroupModalOpen(false);
      toast.success('Group added to community');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to link group');
    }
  };

  const handleUnlinkGroup = async (groupId: string) => {
    if (!selected) return;
    try {
      await communitiesApi.removeGroup(selected.id, groupId);
      const updated = await communitiesApi.getCommunity(selected.id);
      setSelected(updated);
      toast.success('Group removed from community');
    } catch {
      toast.error('Failed to remove group');
    }
  };

  const handleDeleteCommunity = async (id: string) => {
    try {
      await communitiesApi.deleteCommunity(id);
      setSelected(null);
      await loadCommunities();
      toast.success('Community deleted');
    } catch {
      toast.error('Failed to delete community');
    }
  };

  const availableGroups = conversations
    .filter((c) => c.type === ConversationType.GROUP && c.group)
    .map((c) => c.group!);

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
                  void communitiesApi.getCommunity(c.id).then(setSelected).catch(() => {});
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
            <div className="bg-white dark:bg-[#202c33] rounded-2xl p-6 flex items-center justify-between gap-4 shadow-sm">
              <div className="flex items-center gap-4">
                <Avatar src={selected.avatarUrl} name={selected.name} size="lg" isGroup />
                <div>
                  <h2 className="text-xl font-bold">{selected.name}</h2>
                  <p className="text-sm text-[#667781] dark:text-[#8696a0]">
                    {selected.description || 'Community hub'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setLinkGroupModalOpen(true)}
                  className="px-3.5 py-2 rounded-xl bg-[#00A884] text-white text-xs font-semibold flex items-center gap-1.5"
                >
                  <FolderPlus className="w-4 h-4" /> Add Group
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteCommunity(selected.id)}
                  className="p-2 rounded-xl text-red-500 hover:bg-red-500/10"
                  title="Delete Community"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

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
                  {selected.groups.map((g) => (
                    <div key={g.id} className="py-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Avatar src={g.avatarUrl} name={g.name} size="sm" isGroup />
                        <div>
                          <p className="text-sm font-medium">{g.name}</p>
                          <p className="text-xs text-[#667781]">{g.description}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const conv = conversations.find((c) => c.groupId === g.id);
                            if (conv) setActiveConversation(conv.id);
                          }}
                          className="text-xs text-[#00A884] font-semibold hover:underline"
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleUnlinkGroup(g.id)}
                          className="text-xs text-red-500 hover:underline"
                        >
                          Remove
                        </button>
                      </div>
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
                className="px-4 py-2 rounded-lg text-sm bg-[#00A884] text-white font-semibold"
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
    </div>
  );
};

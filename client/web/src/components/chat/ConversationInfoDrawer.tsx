import React, { useEffect, useState } from 'react';
import {
  X,
  Lock,
  BellOff,
  Bell,
  Ban,
  Flag,
  Trash2,
  UserPlus,
  Link2,
  Copy,
  Shield,
  Clock,
  LogOut,
  Check,
  Edit3,
  Camera,
} from 'lucide-react';
import {
  ConversationType,
  Group,
  GroupMember,
  MemberRole,
  MessageType,
  User,
} from '@whatsapp-pro/shared-types';
import { ConversationWithMeta, LocalMessage, useChatStore } from '@/stores/chatStore';
import { groupsApi, mediaApi, privacyApi, reportsApi } from '@/services/api.services';
import { e2eeManager } from '@/lib/e2ee';
import { extractErrorMessage, resolveMediaUrl } from '@/lib/api';
import { Avatar } from '@/components/common/Avatar';
import { ImageCropModal } from '@/components/common/ImageCropModal';
import { toast } from '@/stores/toastStore';

interface ConversationInfoDrawerProps {
  conversation: ConversationWithMeta;
  messages: LocalMessage[];
  currentUserId: string;
  onClose: () => void;
}

export const ConversationInfoDrawer: React.FC<ConversationInfoDrawerProps> = ({
  conversation,
  messages,
  currentUserId,
  onClose,
}) => {
  const { muteConversation, blockUser, unblockUser, blockedUsers, searchUsers, fetchConversations } =
    useChatStore();

  const isGroup = conversation.type === ConversationType.GROUP;
  const otherMember = !isGroup
    ? conversation.members?.find((m) => m.userId !== currentUserId)?.user
    : undefined;

  const [groupDetails, setGroupDetails] = useState<Group | null>(conversation.group || null);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState<string>('');
  const [mediaTab, setMediaTab] = useState<'media' | 'docs' | 'links'>('media');

  // Group editing & add members
  const [editingGroupInfo, setEditingGroupInfo] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [cropGroupFile, setCropGroupFile] = useState<File | null>(null);

  // Disappearing timeout
  const [disappearingTimeout, setDisappearingTimeout] = useState<number>(
    conversation.disappearingMessagesTimeout || 0,
  );

  // Report Modal
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('SPAM');
  const [reportDesc, setReportDesc] = useState('');

  useEffect(() => {
    void e2eeManager.getOwnFingerprint().then(setFingerprint);
  }, []);

  useEffect(() => {
    if (isGroup && conversation.groupId) {
      void groupsApi.getGroup(conversation.groupId).then((g) => {
        setGroupDetails(g);
        setGroupName(g.name);
        setGroupDesc(g.description || '');
        if (g.inviteLink) setInviteUrl(`${window.location.origin}/join/${g.inviteLink}`);
      });
      void groupsApi.getMembers(conversation.groupId).then(setGroupMembers);
    }
  }, [isGroup, conversation.groupId]);

  const myRole =
    groupMembers.find((m) => m.userId === currentUserId)?.role ||
    conversation.members?.find((m) => m.userId === currentUserId)?.role ||
    MemberRole.MEMBER;
  const isAdmin = myRole === MemberRole.ADMIN || myRole === MemberRole.OWNER;

  const mediaMessages = messages.filter(
    (m) => m.messageType === MessageType.IMAGE || m.messageType === MessageType.VIDEO,
  );
  const docMessages = messages.filter((m) => m.messageType === MessageType.DOCUMENT);
  const linkMessages = messages.filter((m) =>
    /https?:\/\/[^\s]+/i.test(m.decryptedContent || m.content || ''),
  );

  const isBlocked = otherMember ? blockedUsers.some((u) => u.id === otherMember.id) : false;

  const handleSaveGroupInfo = async () => {
    if (!conversation.groupId || !groupName.trim()) return;
    try {
      const updated = await groupsApi.updateGroup(conversation.groupId, {
        name: groupName.trim(),
        description: groupDesc.trim(),
      });
      setGroupDetails(updated);
      setEditingGroupInfo(false);
      await fetchConversations();
      toast.success('Group info updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update group');
    }
  };

  const handleGroupAvatarCropConfirm = async (croppedBlob: Blob) => {
    setCropGroupFile(null);
    if (!conversation.groupId) return;
    try {
      const up = await mediaApi.uploadFile(croppedBlob, 'groups', undefined, 'group-avatar.jpg');
      const updated = await groupsApi.updateGroup(conversation.groupId, { avatarUrl: up.url });
      setGroupDetails(updated);
      await fetchConversations();
      toast.success('Group icon updated');
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to update group icon'));
    }
  };

  const handleTogglePermission = async (
    field: 'onlyAdminsCanMessage' | 'onlyAdminsCanEditInfo',
    value: boolean,
  ) => {
    if (!conversation.groupId) return;
    try {
      const updated = await groupsApi.updateGroup(conversation.groupId, { [field]: value });
      setGroupDetails(updated);
      toast.success('Group permissions updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update permissions');
    }
  };

  const handleGenerateInvite = async () => {
    if (!conversation.groupId) return;
    try {
      const inv = await groupsApi.generateInviteLink(conversation.groupId);
      const url = inv.url || `${window.location.origin}/join/${inv.inviteCode}`;
      setInviteUrl(url);
      toast.success('Invite link generated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate link');
    }
  };

  const handleRevokeInvite = async () => {
    if (!conversation.groupId) return;
    try {
      await groupsApi.revokeInviteLink(conversation.groupId);
      setInviteUrl(null);
      toast.success('Invite link revoked');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to revoke link');
    }
  };

  const handleSearchAddMember = async (q: string) => {
    setMemberSearch(q);
    if (q.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    try {
      const res = await searchUsers(q.trim());
      setSearchResults(res);
    } catch {
      setSearchResults([]);
    }
  };

  const handleAddMember = async (userId: string) => {
    if (!conversation.groupId) return;
    try {
      await groupsApi.addMembers(conversation.groupId, [userId]);
      const refreshed = await groupsApi.getMembers(conversation.groupId);
      setGroupMembers(refreshed);
      setAddMemberOpen(false);
      setMemberSearch('');
      toast.success('Member added');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add member');
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!conversation.groupId) return;
    try {
      await groupsApi.removeMember(conversation.groupId, userId);
      setGroupMembers((prev) => prev.filter((m) => m.userId !== userId));
      toast.success(userId === currentUserId ? 'Left group' : 'Member removed');
      if (userId === currentUserId) {
        await fetchConversations();
        onClose();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove member');
    }
  };

  const handleToggleAdmin = async (member: GroupMember) => {
    if (!conversation.groupId) return;
    const nextRole = member.role === MemberRole.ADMIN ? MemberRole.MEMBER : MemberRole.ADMIN;
    try {
      await groupsApi.updateMemberRole(conversation.groupId, member.userId, nextRole);
      setGroupMembers((prev) =>
        prev.map((m) => (m.userId === member.userId ? { ...m, role: nextRole } : m)),
      );
      toast.success(`Updated role to ${nextRole}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update role');
    }
  };

  const handleDisappearingChange = async (seconds: number) => {
    setDisappearingTimeout(seconds);
    try {
      await privacyApi.setDisappearingMessages(conversation.id, seconds === 0 ? null : seconds);
      toast.success('Disappearing messages timer updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update timer');
    }
  };

  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetId = otherMember?.id || conversation.createdBy;
    try {
      await reportsApi.submitReport({
        reportedUserId: targetId,
        reason: reportReason,
        description: reportDesc.trim() || undefined,
      });
      setReportOpen(false);
      setReportDesc('');
      toast.success('Report submitted to moderation team');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit report');
    }
  };

  const title = isGroup
    ? groupDetails?.name || 'Group Chat'
    : otherMember?.displayName || 'Contact Info';

  return (
    <aside className="w-full lg:w-80 xl:w-96 border-l border-gray-200 dark:border-[#2a3942] bg-[#f0f2f5] dark:bg-[#111b21] flex flex-col h-full overflow-hidden shrink-0">
      {/* Drawer Header */}
      <div className="h-14 px-4 bg-[#f0f2f5] dark:bg-[#202c33] border-b border-gray-200 dark:border-[#2a3942] flex items-center justify-between shrink-0">
        <span className="font-semibold text-sm">{isGroup ? 'Group info' : 'Contact info'}</span>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-full hover:bg-gray-200 dark:hover:bg-[#2a3942]"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2.5 pb-6">
        {/* Profile Card */}
        <div className="bg-white dark:bg-[#202c33] p-6 flex flex-col items-center text-center">
          {isGroup && isAdmin ? (
            <label className="relative cursor-pointer group">
              <Avatar
                src={groupDetails?.avatarUrl}
                name={title}
                size="xl"
                isGroup
              />
              <span className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-[#00A884] text-white flex items-center justify-center shadow">
                <Camera className="w-4 h-4" />
              </span>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) setCropGroupFile(file);
                }}
                className="hidden"
              />
            </label>
          ) : (
            <Avatar
              src={isGroup ? groupDetails?.avatarUrl : otherMember?.avatarUrl}
              name={title}
              size="xl"
              isGroup={isGroup}
            />
          )}
          {editingGroupInfo ? (
            <div className="w-full mt-4 space-y-2">
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-sm"
              />
              <textarea
                rows={2}
                value={groupDesc}
                onChange={(e) => setGroupDesc(e.target.value)}
                placeholder="Group description"
                className="w-full px-3 py-1.5 rounded-lg border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-xs"
              />
              <div className="flex justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditingGroupInfo(false)}
                  className="px-3 py-1 text-xs rounded-lg bg-gray-200 dark:bg-[#2a3942]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveGroupInfo()}
                  className="px-3 py-1 text-xs rounded-lg bg-[#00A884] text-white flex items-center gap-1"
                >
                  <Check className="w-3.5 h-3.5" /> Save
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mt-3">
                <h3 className="text-lg font-semibold">{title}</h3>
                {isGroup && isAdmin && (
                  <button
                    type="button"
                    onClick={() => setEditingGroupInfo(true)}
                    className="text-[#667781] hover:text-[#00A884]"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                )}
              </div>
              {isGroup ? (
                <p className="text-xs text-[#667781] dark:text-[#8696a0] mt-1">
                  Group · {groupMembers.length || conversation.members?.length || 0} participants
                </p>
              ) : (
                <p className="text-xs text-[#667781] dark:text-[#8696a0] mt-1 font-mono">
                  {otherMember?.phoneNumber || ''} {otherMember?.username ? `· @${otherMember.username}` : ''}
                </p>
              )}
              {(isGroup ? groupDetails?.description : otherMember?.about) && (
                <p className="text-xs text-[#667781] dark:text-[#8696a0] mt-3 max-w-xs">
                  {isGroup ? groupDetails?.description : otherMember?.about}
                </p>
              )}
            </>
          )}
        </div>

        {/* Shared Media / Docs / Links */}
        <div className="bg-white dark:bg-[#202c33] p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-[#667781] dark:text-[#8696a0]">
              Shared Media, Links & Docs
            </span>
          </div>
          <div className="flex gap-2 mb-3 text-xs">
            {(['media', 'docs', 'links'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setMediaTab(tab)}
                className={`px-3 py-1 rounded-full capitalize font-medium ${
                  mediaTab === tab
                    ? 'bg-[#00A884] text-white'
                    : 'bg-gray-100 dark:bg-[#2a3942] text-[#667781] dark:text-[#8696a0]'
                }`}
              >
                {tab} (
                {tab === 'media'
                  ? mediaMessages.length
                  : tab === 'docs'
                    ? docMessages.length
                    : linkMessages.length}
                )
              </button>
            ))}
          </div>
          {mediaTab === 'media' && (
            <div className="grid grid-cols-3 gap-1.5 max-h-40 overflow-y-auto">
              {mediaMessages.length === 0 ? (
                <p className="col-span-3 text-xs text-[#667781] py-3 text-center">No media shared yet</p>
              ) : (
                mediaMessages.slice(0, 9).map((m) => (
                  <img
                    key={m.id}
                    src={resolveMediaUrl(m.attachments?.[0]?.fileUrl) || ''}
                    alt="Media"
                    className="w-full h-20 object-cover rounded-lg bg-gray-200 dark:bg-[#2a3942]"
                  />
                ))
              )}
            </div>
          )}
          {mediaTab === 'docs' && (
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {docMessages.length === 0 ? (
                <p className="text-xs text-[#667781] py-3 text-center">No documents shared</p>
              ) : (
                docMessages.map((m) => (
                  <a
                    key={m.id}
                    href={resolveMediaUrl(m.attachments?.[0]?.fileUrl) || '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-xs p-2 rounded-lg bg-gray-50 dark:bg-[#111b21] truncate hover:underline"
                  >
                    {m.attachments?.[0]?.fileName || 'Document'}
                  </a>
                ))
              )}
            </div>
          )}
          {mediaTab === 'links' && (
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {linkMessages.length === 0 ? (
                <p className="text-xs text-[#667781] py-3 text-center">No links shared</p>
              ) : (
                linkMessages.map((m) => (
                  <p key={m.id} className="text-xs text-[#027eb5] truncate p-1.5">
                    {m.decryptedContent || m.content}
                  </p>
                ))
              )}
            </div>
          )}
        </div>

        {/* Settings & E2EE */}
        <div className="bg-white dark:bg-[#202c33] divide-y divide-gray-100 dark:divide-[#2a3942] text-sm">
          <button
            type="button"
            onClick={() => void muteConversation(conversation.id, !conversation.isMuted)}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-[#182229]"
          >
            <span className="flex items-center gap-3">
              {conversation.isMuted ? (
                <Bell className="w-4 h-4 text-[#00A884]" />
              ) : (
                <BellOff className="w-4 h-4 text-[#667781]" />
              )}
              <span>{conversation.isMuted ? 'Unmute notifications' : 'Mute notifications'}</span>
            </span>
          </button>

          <div className="px-4 py-3 flex items-center justify-between gap-2">
            <span className="flex items-center gap-3">
              <Clock className="w-4 h-4 text-[#667781]" />
              <span>Disappearing messages</span>
            </span>
            <select
              value={disappearingTimeout}
              onChange={(e) => void handleDisappearingChange(Number(e.target.value))}
              className="text-xs rounded-lg bg-gray-100 dark:bg-[#2a3942] px-2 py-1 focus:outline-none"
            >
              <option value={0}>Off</option>
              <option value={86400}>24 hours</option>
              <option value={604800}>7 days</option>
              <option value={7776000}>90 days</option>
            </select>
          </div>

          <div className="px-4 py-3">
            <div className="flex items-center gap-3 mb-1">
              <Lock className="w-4 h-4 text-[#00A884]" />
              <span className="font-medium">Encryption</span>
            </div>
            <p className="text-xs text-[#667781] dark:text-[#8696a0] pl-7">
              Messages are secured with Signal Protocol E2EE. Safety key:{' '}
              <span className="font-mono text-[10px] block mt-1 break-all">{fingerprint || 'Initializing...'}</span>
            </p>
          </div>
        </div>

        {/* Group Management Section */}
        {isGroup && (
          <div className="bg-white dark:bg-[#202c33] p-4 space-y-4">
            {isAdmin && (
              <div className="space-y-2 pb-3 border-b border-gray-100 dark:border-[#2a3942]">
                <p className="text-xs font-semibold text-[#667781] dark:text-[#8696a0]">
                  Group Permissions
                </p>
                <label className="flex items-center justify-between text-xs cursor-pointer">
                  <span>Only admins can send messages</span>
                  <input
                    type="checkbox"
                    checked={Boolean(groupDetails?.onlyAdminsCanMessage)}
                    onChange={(e) =>
                      void handleTogglePermission('onlyAdminsCanMessage', e.target.checked)
                    }
                    className="accent-[#00A884]"
                  />
                </label>
                <label className="flex items-center justify-between text-xs cursor-pointer">
                  <span>Only admins can edit group info</span>
                  <input
                    type="checkbox"
                    checked={Boolean(groupDetails?.onlyAdminsCanEditInfo)}
                    onChange={(e) =>
                      void handleTogglePermission('onlyAdminsCanEditInfo', e.target.checked)
                    }
                    className="accent-[#00A884]"
                  />
                </label>
              </div>
            )}

            {/* Invite Link */}
            {isAdmin && (
              <div className="space-y-2 pb-3 border-b border-gray-100 dark:border-[#2a3942]">
                <p className="text-xs font-semibold text-[#667781] dark:text-[#8696a0]">
                  Invite via Link
                </p>
                {inviteUrl ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 dark:bg-[#111b21] text-xs">
                      <Link2 className="w-4 h-4 text-[#00A884] shrink-0" />
                      <span className="truncate flex-1 font-mono">{inviteUrl}</span>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(inviteUrl);
                          toast.success('Invite link copied');
                        }}
                      >
                        <Copy className="w-4 h-4 text-[#00A884]" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleRevokeInvite()}
                      className="text-xs text-red-500 hover:underline"
                    >
                      Revoke invite link
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleGenerateInvite()}
                    className="text-xs text-[#00A884] font-semibold flex items-center gap-1.5 hover:underline"
                  >
                    <Link2 className="w-3.5 h-3.5" /> Generate invite link
                  </button>
                )}
              </div>
            )}

            {/* Members List */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-[#667781] dark:text-[#8696a0]">
                  {groupMembers.length} Participants
                </p>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setAddMemberOpen((v) => !v)}
                    className="text-xs text-[#00A884] font-semibold flex items-center gap-1"
                  >
                    <UserPlus className="w-3.5 h-3.5" /> Add
                  </button>
                )}
              </div>

              {addMemberOpen && (
                <div className="mb-3 p-2 rounded-xl bg-gray-50 dark:bg-[#111b21] border border-gray-200 dark:border-[#2a3942]">
                  <input
                    type="text"
                    value={memberSearch}
                    onChange={(e) => void handleSearchAddMember(e.target.value)}
                    placeholder="Search username or +phone..."
                    className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#202c33] text-xs mb-2 focus:outline-none"
                  />
                  {searchResults.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => void handleAddMember(u.id)}
                      className="w-full text-left px-2 py-1.5 text-xs hover:bg-gray-200 dark:hover:bg-[#2a3942] rounded-lg flex items-center justify-between"
                    >
                      <span>{u.displayName}</span>
                      <span className="text-[#00A884]">Add</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="space-y-2 max-h-60 overflow-y-auto">
                {groupMembers.map((member) => (
                  <div key={member.id} className="flex items-center justify-between gap-2 py-1">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar
                        src={member.user?.avatarUrl}
                        name={member.user?.displayName || 'Member'}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">
                          {member.userId === currentUserId
                            ? 'You'
                            : member.user?.displayName || member.userId}
                        </p>
                        {member.role !== MemberRole.MEMBER && (
                          <span className="text-[10px] text-[#00A884] font-semibold">
                            {member.role}
                          </span>
                        )}
                      </div>
                    </div>

                    {isAdmin && member.userId !== currentUserId && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void handleToggleAdmin(member)}
                          title={member.role === MemberRole.ADMIN ? 'Demote' : 'Make Admin'}
                          className="p-1 text-xs text-[#00A884] hover:bg-gray-100 dark:hover:bg-[#2a3942] rounded"
                        >
                          <Shield className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRemoveMember(member.userId)}
                          title="Remove member"
                          className="p-1 text-xs text-red-500 hover:bg-gray-100 dark:hover:bg-[#2a3942] rounded"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Danger Zone */}
        <div className="bg-white dark:bg-[#202c33] divide-y divide-gray-100 dark:divide-[#2a3942] text-sm">
          {!isGroup && otherMember && (
            <button
              type="button"
              onClick={() =>
                void (isBlocked ? unblockUser(otherMember.id) : blockUser(otherMember.id)).then(() =>
                  toast.success(isBlocked ? 'User unblocked' : 'User blocked'),
                )
              }
              className="w-full px-4 py-3 flex items-center gap-3 text-red-500 hover:bg-gray-50 dark:hover:bg-[#182229]"
            >
              <Ban className="w-4 h-4" />
              <span>{isBlocked ? `Unblock ${otherMember.displayName}` : `Block ${otherMember.displayName}`}</span>
            </button>
          )}

          {isGroup && (
            <button
              type="button"
              onClick={() => void handleRemoveMember(currentUserId)}
              className="w-full px-4 py-3 flex items-center gap-3 text-red-500 hover:bg-gray-50 dark:hover:bg-[#182229]"
            >
              <LogOut className="w-4 h-4" />
              <span>Exit group</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setReportOpen(true)}
            className="w-full px-4 py-3 flex items-center gap-3 text-red-500 hover:bg-gray-50 dark:hover:bg-[#182229]"
          >
            <Flag className="w-4 h-4" />
            <span>Report {isGroup ? 'group' : 'user'}</span>
          </button>
        </div>
      </div>

      {/* Report Modal */}
      {reportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handleReportSubmit}
            className="bg-white dark:bg-[#202c33] rounded-2xl p-6 max-w-md w-full shadow-xl border border-gray-200 dark:border-[#2a3942]"
          >
            <h3 className="font-semibold text-base mb-2">Report {title}</h3>
            <p className="text-xs text-[#667781] dark:text-[#8696a0] mb-4">
              Reports send account metadata to moderators without exposing your private chat history.
            </p>
            <select
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-sm mb-3"
            >
              <option value="SPAM">Spam or unwanted messages</option>
              <option value="HARASSMENT">Harassment or abuse</option>
              <option value="IMPERSONATION">Impersonation</option>
              <option value="SCAM">Scam or fraud</option>
              <option value="OTHER">Other</option>
            </select>
            <textarea
              rows={3}
              value={reportDesc}
              onChange={(e) => setReportDesc(e.target.value)}
              placeholder="Optional details..."
              className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-sm mb-4"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReportOpen(false)}
                className="px-4 py-2 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-[#2a3942]"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg text-sm bg-red-600 text-white font-medium"
              >
                Submit Report
              </button>
            </div>
          </form>
        </div>
      )}
      <ImageCropModal
        file={cropGroupFile}
        shape="circle"
        title="Crop Group Icon"
        onCancel={() => setCropGroupFile(null)}
        onConfirm={(blob) => void handleGroupAvatarCropConfirm(blob)}
      />
    </aside>
  );
};

import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Users, ArrowRight, CheckCircle2 } from 'lucide-react';
import { groupsApi } from '@/services/api.services';
import { useChatStore } from '@/stores/chatStore';
import { toast } from '@/stores/toastStore';

export const JoinInvitePage: React.FC = () => {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  const { fetchConversations } = useChatStore();
  const [joining, setJoining] = useState(false);

  const handleJoin = async () => {
    if (!inviteCode) return;
    setJoining(true);
    try {
      const res = await groupsApi.joinViaInviteCode(inviteCode);
      await fetchConversations();
      toast.success(`Joined group "${res.group?.name || 'Group'}"!`);
      navigate(res.conversationId ? `/chats/${res.conversationId}` : '/', { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid or expired invite link');
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center bg-[#f0f2f5] dark:bg-[#0b141a] p-4">
      <div className="bg-white dark:bg-[#202c33] rounded-2xl shadow-xl border border-gray-200 dark:border-[#2a3942] max-w-md w-full p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[#00A884]/15 text-[#00A884] flex items-center justify-center">
          <Users className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold mb-2">Group Invite Link</h2>
        <p className="text-xs text-[#667781] dark:text-[#8696a0] mb-6">
          Invite Code: <span className="font-mono font-semibold text-[#00A884]">{inviteCode}</span>
        </p>
        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            disabled={joining}
            onClick={() => void handleJoin()}
            className="w-full py-3 rounded-xl bg-[#00A884] hover:bg-[#008f6f] text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <CheckCircle2 className="w-4 h-4" />
            {joining ? 'Joining Group...' : 'Join Group'}
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="w-full py-2.5 rounded-xl text-xs text-[#667781] hover:underline"
          >
            Back to Chats
          </button>
        </div>
      </div>
    </div>
  );
};

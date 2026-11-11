import React, { useEffect, useState } from 'react';
import {
  Phone,
  Video,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Plus,
  X,
} from 'lucide-react';
import { CallStatus, CallType, ConversationType, User } from '@whatsapp-pro/shared-types';
import { useCallStore } from '@/stores/callStore';
import { useChatStore } from '@/stores/chatStore';
import { useAuthStore } from '@/stores/authStore';
import { Avatar } from '@/components/common/Avatar';
import { toast } from '@/stores/toastStore';

function fmtDuration(sec?: number | null): string {
  if (!sec) return '0:00';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export const CallsPage: React.FC = () => {
  const { user } = useAuthStore();
  const { callHistory, isLoadingHistory, fetchCallHistory, initiateCall } = useCallStore();
  const { conversations, fetchConversations } = useChatStore();

  const [filter, setFilter] = useState<'all' | 'missed'>('all');
  const [newCallModalOpen, setNewCallModalOpen] = useState(false);

  useEffect(() => {
    void fetchCallHistory();
    void fetchConversations();
  }, [fetchCallHistory, fetchConversations]);

  const currentUserId = user?.id || '';

  const filteredCalls = callHistory.filter((c) =>
    filter === 'missed'
      ? c.status === CallStatus.MISSED || c.status === CallStatus.REJECTED
      : true,
  );

  const startCallForConv = async (conversationId: string, callType: CallType, peers: User[]) => {
    try {
      setNewCallModalOpen(false);
      await initiateCall(conversationId, callType, peers);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to start call');
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-white dark:bg-[#111b21] overflow-hidden">
      <div className="h-14 px-6 bg-[#f0f2f5] dark:bg-[#202c33] border-b border-gray-200 dark:border-[#2a3942] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold">Calls</h1>
          <div className="flex gap-1.5">
            {(['all', 'missed'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setFilter(tab)}
                className={`px-3 py-1 rounded-full text-xs font-medium capitalize ${
                  filter === tab
                    ? 'bg-[#00A884] text-white'
                    : 'bg-gray-200/70 dark:bg-[#2a3942] text-[#667781] dark:text-[#aebac1]'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setNewCallModalOpen(true)}
          className="px-4 py-1.5 rounded-full bg-[#00A884] hover:bg-[#008f6f] text-white text-xs font-semibold flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" /> New Call
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-3xl w-full mx-auto space-y-2">
        {isLoadingHistory ? (
          <p className="text-sm text-[#667781] text-center py-10">Loading call history...</p>
        ) : filteredCalls.length === 0 ? (
          <div className="text-center py-16">
            <Phone className="w-12 h-12 mx-auto mb-3 text-[#00A884] opacity-70" />
            <p className="font-medium text-sm">No call records yet</p>
            <p className="text-xs text-[#667781] mt-1">
              Start an encrypted HD audio or video call with any contact or group.
            </p>
          </div>
        ) : (
          filteredCalls.map((call) => {
            const isOutgoing = call.callerId === currentUserId;
            const isMissed = call.status === CallStatus.MISSED || call.status === CallStatus.REJECTED;
            const peer = isOutgoing
              ? call.participants?.find((p) => p.userId !== currentUserId)?.user
              : call.caller;

            const title = peer?.displayName || 'Call Participant';

            return (
              <div
                key={call.id}
                className="flex items-center justify-between p-3.5 rounded-2xl bg-[#f8f9fa] dark:bg-[#202c33] border border-gray-100 dark:border-[#2a3942]"
              >
                <div className="flex items-center gap-3.5">
                  <Avatar src={peer?.avatarUrl} name={title} size="md" />
                  <div>
                    <p className={`font-semibold text-sm ${isMissed ? 'text-red-500' : ''}`}>
                      {title}
                    </p>
                    <div className="flex items-center gap-1.5 text-xs text-[#667781] dark:text-[#8696a0]">
                      {isMissed ? (
                        <PhoneMissed className="w-3.5 h-3.5 text-red-500" />
                      ) : isOutgoing ? (
                        <PhoneOutgoing className="w-3.5 h-3.5 text-[#25D366]" />
                      ) : (
                        <PhoneIncoming className="w-3.5 h-3.5 text-[#00A884]" />
                      )}
                      <span>{new Date(call.createdAt).toLocaleString()}</span>
                      {call.durationSeconds ? <span>· {fmtDuration(call.durationSeconds)}</span> : null}
                    </div>
                  </div>
                </div>

                {call.conversationId && (
                  <button
                    type="button"
                    onClick={() =>
                      void startCallForConv(
                        call.conversationId!,
                        call.callType,
                        peer ? [peer] : [],
                      )
                    }
                    className="p-2.5 rounded-full hover:bg-gray-200 dark:hover:bg-[#2a3942] text-[#00A884]"
                    title="Call Back"
                  >
                    {call.callType === CallType.VIDEO ? (
                      <Video className="w-5 h-5" />
                    ) : (
                      <Phone className="w-5 h-5" />
                    )}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Start New Call Modal */}
      {newCallModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-[#202c33] rounded-2xl max-w-md w-full p-5 shadow-xl border border-gray-200 dark:border-[#2a3942]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-base">Start a Call</h3>
              <button type="button" onClick={() => setNewCallModalOpen(false)}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {conversations.length === 0 ? (
                <p className="text-xs text-[#667781] text-center py-6">
                  Start a chat first to place a call.
                </p>
              ) : (
                conversations.map((conv) => {
                  const isGroup = conv.type === ConversationType.GROUP;
                  const peers = (conv.members || [])
                    .map((m) => m.user)
                    .filter((u): u is User => Boolean(u && u.id !== currentUserId));
                  const label = isGroup
                    ? conv.group?.name || 'Group'
                    : peers[0]?.displayName || 'Chat';
                  return (
                    <div
                      key={conv.id}
                      className="flex items-center justify-between p-2.5 rounded-xl hover:bg-gray-100 dark:hover:bg-[#2a3942]"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar
                          src={isGroup ? conv.group?.avatarUrl : peers[0]?.avatarUrl}
                          name={label}
                          size="sm"
                          isGroup={isGroup}
                        />
                        <span className="text-sm font-medium truncate">{label}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void startCallForConv(conv.id, CallType.AUDIO, peers)}
                          className="p-2 rounded-full hover:bg-[#00A884]/15 text-[#00A884]"
                          title="Audio Call"
                        >
                          <Phone className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void startCallForConv(conv.id, CallType.VIDEO, peers)}
                          className="p-2 rounded-full hover:bg-[#00A884]/15 text-[#00A884]"
                          title="Video Call"
                        >
                          <Video className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

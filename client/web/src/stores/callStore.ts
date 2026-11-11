import { create } from 'zustand';
import { Call, CallStatus, CallType, SocketEvents, User } from '@whatsapp-pro/shared-types';
import { api, unwrapData } from '@/lib/api';
import { socketManager } from '@/lib/socket';
import { ConnectionQualityStats, webrtcManager } from '@/lib/webrtc';
import { callsApi } from '@/services/api.services';
import { useAuthStore } from './authStore';

export interface ActiveCallSession {
  id: string;
  callType: CallType;
  conversationId?: string | null;
  status: CallStatus;
  isOutgoing: boolean;
  peerUsers: User[];
  startedAt?: number;
}

class RingtonePlayer {
  private ctx: AudioContext | null = null;
  private intervalId: number | null = null;

  start() {
    if (this.intervalId) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      const playTone = () => {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, this.ctx.currentTime);
        osc.frequency.setValueAtTime(480, this.ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.8);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.8);
      };
      playTone();
      this.intervalId = window.setInterval(playTone, 2200);
    } catch {
      // Ignore autoplay restrictions
    }
  }

  stop() {
    if (this.intervalId) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}

const ringtone = new RingtonePlayer();

interface CallState {
  activeCall: ActiveCallSession | null;
  incomingCall: ActiveCallSession | null;
  callHistory: Call[];
  localStream: MediaStream | null;
  remoteStreams: Record<string, MediaStream>;
  isMuted: boolean;
  isCameraOff: boolean;
  isScreenSharing: boolean;
  isSpeakerOn: boolean;
  durationSeconds: number;
  connectionQuality: ConnectionQualityStats;
  isLoadingHistory: boolean;

  fetchCallHistory: () => Promise<void>;
  initiateCall: (conversationId: string, callType: CallType, peerUsers: User[]) => Promise<void>;
  acceptIncomingCall: () => Promise<void>;
  rejectIncomingCall: () => Promise<void>;
  endActiveCall: () => Promise<void>;
  toggleMute: () => void;
  toggleCamera: () => void;
  toggleScreenShare: () => Promise<void>;
  toggleSpeaker: () => void;
  initCallSocketListeners: () => () => void;
}

let durationTimerId: number | null = null;

interface QueuedOffer {
  callId: string;
  fromUserId: string;
  sdp: RTCSessionDescriptionInit;
}

interface QueuedIce {
  callId: string;
  fromUserId: string;
  candidate: RTCIceCandidateInit;
}

const pendingOffersByCall = new Map<string, QueuedOffer[]>();
const pendingIceByCall = new Map<string, QueuedIce[]>();

function clearPendingSignals(callId?: string | null) {
  if (!callId) return;
  pendingOffersByCall.delete(callId);
  pendingIceByCall.delete(callId);
}

async function flushPendingSignalsForCall(callId: string) {
  const offers = pendingOffersByCall.get(callId) || [];
  pendingOffersByCall.delete(callId);
  for (const item of offers) {
    await webrtcManager.handleOffer(item.fromUserId, item.callId, item.sdp);
  }

  const candidates = pendingIceByCall.get(callId) || [];
  pendingIceByCall.delete(callId);
  for (const item of candidates) {
    await webrtcManager.handleIceCandidate(item.fromUserId, item.candidate);
  }
}

function isValidCallId(callId?: string | null): callId is string {
  return (
    typeof callId === 'string' &&
    callId.trim().length > 0 &&
    callId !== 'undefined' &&
    callId !== 'null'
  );
}

function extractCallId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const obj = payload as {
    id?: string;
    callId?: string;
    call?: { id?: string; callId?: string };
  };
  const candidate = obj.call?.id ?? obj.call?.callId ?? obj.id ?? obj.callId;
  return isValidCallId(candidate) ? candidate : undefined;
}

async function findStaleCallId(err: unknown): Promise<string | undefined> {
  const axiosErr = err as {
    response?: { status?: number; data?: { message?: string | string[] } };
  };
  if (axiosErr?.response?.status !== 409) return undefined;

  const rawMsg = axiosErr.response.data?.message;
  const msgText = Array.isArray(rawMsg) ? rawMsg.join(' ') : String(rawMsg || '');
  const uuidMatch = msgText.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  );
  if (uuidMatch && isValidCallId(uuidMatch[0])) {
    return uuidMatch[0];
  }

  try {
    const activeRes = await api.get('/calls/active');
    const activeData = unwrapData<{ id?: string; call?: { id?: string } } | null>(activeRes.data);
    return extractCallId(activeData);
  } catch {
    return undefined;
  }
}

function startDurationTimer(set: (partial: Partial<CallState>) => void) {
  if (durationTimerId) return;
  const startTime = Date.now();
  durationTimerId = window.setInterval(() => {
    set({ durationSeconds: Math.floor((Date.now() - startTime) / 1000) });
  }, 1000);
}

function stopDurationTimer() {
  if (durationTimerId) {
    window.clearInterval(durationTimerId);
    durationTimerId = null;
  }
}

export const useCallStore = create<CallState>((set, get) => ({
  activeCall: null,
  incomingCall: null,
  callHistory: [],
  localStream: null,
  remoteStreams: {},
  isMuted: false,
  isCameraOff: false,
  isScreenSharing: false,
  isSpeakerOn: true,
  durationSeconds: 0,
  connectionQuality: { quality: 'good' },
  isLoadingHistory: false,

  fetchCallHistory: async () => {
    set({ isLoadingHistory: true });
    try {
      const history = await callsApi.getHistory();
      set({ callHistory: history, isLoadingHistory: false });
    } catch {
      set({ isLoadingHistory: false });
    }
  },

  initiateCall: async (conversationId, callType, peerUsers) => {
    const isVideo = callType === CallType.VIDEO;
    try {
      const localStream = await webrtcManager.startLocalMedia(isVideo);

      let res;
      try {
        res = await api.post('/calls', {
          conversationId,
          callType,
        });
      } catch (err) {
        const staleId = await findStaleCallId(err);
        if (staleId) {
          await api.post(`/calls/${staleId}/end`).catch(() => {});
          res = await api.post('/calls', {
            conversationId,
            callType,
          });
        } else {
          throw err;
        }
      }

      const unwrapped = unwrapData<Call | { call?: Call; callId?: string }>(res.data);
      const callId = extractCallId(unwrapped);
      if (!isValidCallId(callId)) {
        throw new Error('Server did not return a valid call ID');
      }

      await webrtcManager.initCall(callId, isVideo);
      webrtcManager.setHandlers({
        onRemoteStream: (peerId, stream) => {
          set((s) => ({
            remoteStreams: { ...s.remoteStreams, [peerId]: stream },
            activeCall: s.activeCall ? { ...s.activeCall, status: CallStatus.ONGOING } : null,
          }));
        },
        onPeerRemoved: (peerId) => {
          set((s) => {
            const next = { ...s.remoteStreams };
            delete next[peerId];
            return { remoteStreams: next };
          });
        },
        onQualityUpdate: (stats) => set({ connectionQuality: stats }),
      });

      set({
        activeCall: {
          id: callId,
          callType,
          conversationId,
          status: CallStatus.RINGING,
          isOutgoing: true,
          peerUsers,
        },
        localStream,
        isMuted: false,
        isCameraOff: !isVideo,
        isScreenSharing: false,
        durationSeconds: 0,
      });

      // Proactively send WebRTC offers to known peers
      const currentUserId = useAuthStore.getState().user?.id;
      for (const peer of peerUsers) {
        if (peer.id !== currentUserId) {
          await webrtcManager.createOfferForPeer(peer.id, callId);
        }
      }
    } catch (err) {
      webrtcManager.cleanup();
      set({
        activeCall: null,
        localStream: null,
        remoteStreams: {},
        isMuted: false,
        isCameraOff: false,
        isScreenSharing: false,
        durationSeconds: 0,
      });
      throw err;
    }
  },

  acceptIncomingCall: async () => {
    const incoming = get().incomingCall;
    if (!incoming || !isValidCallId(incoming.id)) return;
    ringtone.stop();

    const isVideo = incoming.callType === CallType.VIDEO;
    const localStream = await webrtcManager.initCall(incoming.id, isVideo);

    webrtcManager.setHandlers({
      onRemoteStream: (peerId, stream) => {
        set((s) => ({
          remoteStreams: { ...s.remoteStreams, [peerId]: stream },
        }));
      },
      onPeerRemoved: (peerId) => {
        set((s) => {
          const next = { ...s.remoteStreams };
          delete next[peerId];
          return { remoteStreams: next };
        });
      },
      onQualityUpdate: (stats) => set({ connectionQuality: stats }),
    });

    startDurationTimer((partial) => set(partial));

    set({
      incomingCall: null,
      activeCall: {
        ...incoming,
        status: CallStatus.ONGOING,
        startedAt: Date.now(),
      },
      localStream,
      isMuted: false,
      isCameraOff: !isVideo,
      durationSeconds: 0,
    });

    await flushPendingSignalsForCall(incoming.id);
  },

  rejectIncomingCall: async () => {
    const incoming = get().incomingCall;
    if (!incoming) return;
    ringtone.stop();
    if (isValidCallId(incoming.id)) {
      clearPendingSignals(incoming.id);
      try {
        await api.post(`/calls/${incoming.id}/reject`);
      } catch {
        // Ignore
      }
      socketManager.emit('call_reject', { callId: incoming.id }, false);
    }
    set({ incomingCall: null });
  },

  endActiveCall: async () => {
    const active = get().activeCall;
    ringtone.stop();
    stopDurationTimer();
    webrtcManager.cleanup();

    if (active && isValidCallId(active.id)) {
      clearPendingSignals(active.id);
      try {
        await api.post(`/calls/${active.id}/end`);
      } catch {
        // Ignore
      }
      socketManager.emit('call_end', { callId: active.id }, false);
    }

    set({
      activeCall: null,
      localStream: null,
      remoteStreams: {},
      isMuted: false,
      isCameraOff: false,
      isScreenSharing: false,
      durationSeconds: 0,
    });
    void get().fetchCallHistory();
  },

  toggleMute: () => {
    const nextMuted = !get().isMuted;
    webrtcManager.setAudioMuted(nextMuted);
    const active = get().activeCall;
    if (active && isValidCallId(active.id)) {
      socketManager.emit('call_toggle_mute', { callId: active.id, isMuted: nextMuted }, false);
    }
    set({ isMuted: nextMuted });
  },

  toggleCamera: () => {
    const nextOff = !get().isCameraOff;
    webrtcManager.setVideoEnabled(!nextOff);
    const active = get().activeCall;
    if (active && isValidCallId(active.id)) {
      socketManager.emit('call_toggle_video', { callId: active.id, isVideoOn: !nextOff }, false);
    }
    set({ isCameraOff: nextOff });
  },

  toggleScreenShare: async () => {
    if (get().isScreenSharing) {
      await webrtcManager.stopScreenShare();
      set({ isScreenSharing: false });
    } else {
      const screen = await webrtcManager.startScreenShare();
      if (screen) {
        set({ isScreenSharing: true });
      }
    }
  },

  toggleSpeaker: () => set((s) => ({ isSpeakerOn: !s.isSpeakerOn })),

  initCallSocketListeners: () => {
    const handleIncoming = (payload: {
      callId?: string;
      id?: string;
      callType?: CallType;
      conversationId?: string;
      caller?: User;
      callerId?: string;
      participants?: User[];
    }) => {
      const callId = payload.callId || payload.id;
      if (!callId) return;
      const currentUserId = useAuthStore.getState().user?.id;
      if (payload.callerId === currentUserId || payload.caller?.id === currentUserId) return;
      if (get().activeCall?.id === callId || get().incomingCall?.id === callId) return;

      ringtone.start();
      const peers = payload.participants || (payload.caller ? [payload.caller] : []);
      set({
        incomingCall: {
          id: callId,
          callType: payload.callType || CallType.AUDIO,
          conversationId: payload.conversationId,
          status: CallStatus.RINGING,
          isOutgoing: false,
          peerUsers: peers,
        },
      });
    };

    const handleOffer = async (payload: {
      callId: string;
      fromUserId: string;
      sdp?: RTCSessionDescriptionInit;
      offer?: RTCSessionDescriptionInit;
    }) => {
      const sdp = payload.sdp || payload.offer;
      if (!sdp || !payload.fromUserId || !payload.callId) return;
      if (get().activeCall?.id !== payload.callId) {
        const queued = pendingOffersByCall.get(payload.callId) || [];
        queued.push({ callId: payload.callId, fromUserId: payload.fromUserId, sdp });
        pendingOffersByCall.set(payload.callId, queued);
        return;
      }
      await webrtcManager.handleOffer(payload.fromUserId, payload.callId, sdp);
    };

    const handleAnswer = async (payload: {
      callId: string;
      fromUserId: string;
      sdp?: RTCSessionDescriptionInit;
      answer?: RTCSessionDescriptionInit;
    }) => {
      const sdp = payload.sdp || payload.answer;
      if (sdp && payload.fromUserId) {
        await webrtcManager.handleAnswer(payload.fromUserId, sdp);
        startDurationTimer((partial) => set(partial));
        set((s) => ({
          activeCall: s.activeCall
            ? { ...s.activeCall, status: CallStatus.ONGOING, startedAt: s.activeCall.startedAt ?? Date.now() }
            : null,
        }));
      }
    };

    const handleIce = async (payload: {
      callId?: string;
      fromUserId: string;
      candidate: RTCIceCandidateInit;
    }) => {
      if (!payload.candidate || !payload.fromUserId) return;
      if (payload.callId && get().activeCall?.id !== payload.callId) {
        const queued = pendingIceByCall.get(payload.callId) || [];
        queued.push({ callId: payload.callId, fromUserId: payload.fromUserId, candidate: payload.candidate });
        pendingIceByCall.set(payload.callId, queued);
        return;
      }
      await webrtcManager.handleIceCandidate(payload.fromUserId, payload.candidate);
    };

    const handleCallSignal = async (payload: {
      callId: string;
      fromUserId?: string;
      type?: string;
      sdp?: RTCSessionDescriptionInit;
      offer?: RTCSessionDescriptionInit;
      answer?: RTCSessionDescriptionInit;
      candidate?: RTCIceCandidateInit;
    }) => {
      const currentUserId = useAuthStore.getState().user?.id;
      if (!payload?.callId) return;
      if (payload.fromUserId && payload.fromUserId === currentUserId) return;

      if (payload.type === 'peer_joined' && payload.fromUserId) {
        if (get().activeCall?.id === payload.callId) {
          startDurationTimer((partial) => set(partial));
          set((s) => ({
            activeCall: s.activeCall
              ? { ...s.activeCall, status: CallStatus.ONGOING, startedAt: s.activeCall.startedAt ?? Date.now() }
              : null,
          }));
          if (!webrtcManager.hasPeer(payload.fromUserId)) {
            await webrtcManager.createOfferForPeer(payload.fromUserId, payload.callId);
          }
        }
        return;
      }

      if (payload.type === 'peer_left' && payload.fromUserId) {
        webrtcManager.removePeer(payload.fromUserId);
        return;
      }

      if (payload.type === 'offer' && payload.fromUserId) {
        await handleOffer({
          callId: payload.callId,
          fromUserId: payload.fromUserId,
          sdp: payload.sdp,
          offer: payload.offer,
        });
      } else if (payload.type === 'answer' && payload.fromUserId) {
        await handleAnswer({
          callId: payload.callId,
          fromUserId: payload.fromUserId,
          sdp: payload.sdp,
          answer: payload.answer,
        });
      } else if (
        (payload.type === 'ice_candidate' || payload.type === 'ice-candidate') &&
        payload.fromUserId &&
        payload.candidate
      ) {
        await handleIce({
          callId: payload.callId,
          fromUserId: payload.fromUserId,
          candidate: payload.candidate,
        });
      }
    };

    const handleCallEnded = (payload?: { callId?: string }) => {
      const endedId = payload?.callId;
      const activeId = get().activeCall?.id;
      const incomingId = get().incomingCall?.id;
      if (endedId) {
        clearPendingSignals(endedId);
        if (endedId !== activeId && endedId !== incomingId) {
          return;
        }
      } else {
        clearPendingSignals(activeId);
        clearPendingSignals(incomingId);
      }

      ringtone.stop();
      stopDurationTimer();
      webrtcManager.cleanup();
      set({
        activeCall: null,
        incomingCall: null,
        localStream: null,
        remoteStreams: {},
        durationSeconds: 0,
      });
      void get().fetchCallHistory();
    };

    const unsubs = [
      socketManager.on(SocketEvents.CALL_INCOMING, handleIncoming),
      socketManager.on('call_incoming', handleIncoming),
      socketManager.on('call_signal', handleCallSignal),
      socketManager.on(SocketEvents.WEBRTC_OFFER, handleOffer),
      socketManager.on('call_offer_received', handleOffer),
      socketManager.on(SocketEvents.WEBRTC_ANSWER, handleAnswer),
      socketManager.on('call_answer_received', handleAnswer),
      socketManager.on(SocketEvents.WEBRTC_ICE_CANDIDATE, handleIce),
      socketManager.on('ice_candidate_received', handleIce),
      socketManager.on(SocketEvents.CALL_ACCEPTED, () => {
        startDurationTimer((partial) => set(partial));
        set((s) => ({
          activeCall: s.activeCall
            ? { ...s.activeCall, status: CallStatus.ONGOING, startedAt: s.activeCall.startedAt ?? Date.now() }
            : null,
        }));
      }),
      socketManager.on(SocketEvents.CALL_REJECTED, handleCallEnded),
      socketManager.on('call_rejected', handleCallEnded),
      socketManager.on(SocketEvents.CALL_ENDED, handleCallEnded),
      socketManager.on('call_ended', handleCallEnded),
      socketManager.on('call_ended_notification', handleCallEnded),
    ];

    return () => unsubs.forEach((u) => u());
  },
}));

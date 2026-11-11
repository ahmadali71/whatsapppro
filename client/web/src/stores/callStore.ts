import { create } from 'zustand';
import { Call, CallStatus, CallType, SocketEvents, User } from '@whatsapp-pro/shared-types';
import { api, extractErrorMessage, unwrapData } from '@/lib/api';
import { socketManager } from '@/lib/socket';
import { ConnectionQualityStats, webrtcManager } from '@/lib/webrtc';
import { callsApi } from '@/services/api.services';
import { useAuthStore } from './authStore';
import { toast } from './toastStore';

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
  initCallHttpPolling: () => () => void;
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
const dismissedCallIds = new Set<string>();
const iceServersByCall = new Map<string, RTCIceServer[]>();

interface CallParticipantRecord {
  userId: string;
  leftAt?: string | null;
  user?: User;
}

interface CallRecordResponse {
  id: string;
  callType?: CallType;
  status?: CallStatus;
  conversationId?: string | null;
  callerId?: string;
  caller?: User;
  participants?: CallParticipantRecord[];
  iceServers?: RTCIceServer[];
}

interface CallSignalRecord {
  callId: string;
  fromUserId?: string;
  toUserId?: string;
  type?: string;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  status?: string;
}

function mapPeerUsersFromCallRecord(
  callData: CallRecordResponse,
  currentUserId?: string,
): User[] {
  const map = new Map<string, User>();
  if (callData.caller && callData.caller.id !== currentUserId) {
    map.set(callData.caller.id, callData.caller);
  }
  if (Array.isArray(callData.participants)) {
    for (const p of callData.participants) {
      const u = p?.user;
      if (u && u.id !== currentUserId && !p.leftAt) {
        map.set(u.id, u);
      }
    }
  }
  return Array.from(map.values());
}

function clearPendingSignals(callId?: string | null) {
  if (!callId) return;
  pendingOffersByCall.delete(callId);
  pendingIceByCall.delete(callId);
  iceServersByCall.delete(callId);
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

      const unwrapped = unwrapData<Call & { call?: Call; callId?: string; iceServers?: RTCIceServer[] }>(
        res.data,
      );
      const callId = extractCallId(unwrapped);
      if (!isValidCallId(callId)) {
        throw new Error('Server did not return a valid call ID');
      }

      await webrtcManager.initCall(callId, isVideo, unwrapped?.iceServers);
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
    dismissedCallIds.add(incoming.id);
    ringtone.stop();

    const isVideo = incoming.callType === CallType.VIDEO;
    try {
      const localStream = await webrtcManager.initCall(
        incoming.id,
        isVideo,
        iceServersByCall.get(incoming.id),
      );
      await api.post(`/calls/${incoming.id}/join`);

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
    } catch (err) {
      clearPendingSignals(incoming.id);
      stopDurationTimer();
      webrtcManager.cleanup();
      set({
        incomingCall: null,
        activeCall: null,
        localStream: null,
        remoteStreams: {},
        durationSeconds: 0,
      });
      toast.error(extractErrorMessage(err, 'Failed to join call'));
    }
  },

  rejectIncomingCall: async () => {
    const incoming = get().incomingCall;
    if (!incoming) return;
    ringtone.stop();
    if (isValidCallId(incoming.id)) {
      dismissedCallIds.add(incoming.id);
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
      dismissedCallIds.add(active.id);
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
        dismissedCallIds.add(endedId);
        clearPendingSignals(endedId);
        if (endedId !== activeId && endedId !== incomingId) {
          return;
        }
      } else {
        if (activeId) dismissedCallIds.add(activeId);
        if (incomingId) dismissedCallIds.add(incomingId);
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

  initCallHttpPolling: () => {
    let cancelled = false;
    let incomingBusy = false;
    let signalBusy = false;
    let signalTickCount = 0;

    const closeCallSession = (callId?: string) => {
      if (callId) {
        dismissedCallIds.add(callId);
        clearPendingSignals(callId);
      }
      ringtone.stop();
      stopDurationTimer();
      webrtcManager.cleanup();
      set({
        activeCall: null,
        incomingCall: null,
        localStream: null,
        remoteStreams: {},
        isMuted: false,
        isCameraOff: false,
        isScreenSharing: false,
        durationSeconds: 0,
      });
      void get().fetchCallHistory();
    };

    const markCallOngoing = () => {
      ringtone.stop();
      startDurationTimer((partial) => set(partial));
      set((s) => ({
        activeCall: s.activeCall
          ? {
              ...s.activeCall,
              status: CallStatus.ONGOING,
              startedAt: s.activeCall.startedAt ?? Date.now(),
            }
          : null,
      }));
    };

    const pollIncoming = async () => {
      if (cancelled || incomingBusy || socketManager.isConnected || get().activeCall) return;
      const currentUserId = useAuthStore.getState().user?.id;
      if (!currentUserId) return;

      incomingBusy = true;
      try {
        const res = await api.get('/calls/incoming');
        if (cancelled || get().activeCall) return;
        const raw = unwrapData<CallRecordResponse[] | { calls?: CallRecordResponse[] }>(res.data);
        const list = Array.isArray(raw) ? raw : raw?.calls || [];

        const currentIncoming = get().incomingCall;
        if (currentIncoming && !list.some((c) => c.id === currentIncoming.id)) {
          ringtone.stop();
          set({ incomingCall: null });
        }

        const nextCall = list.find(
          (c) =>
            isValidCallId(c.id) &&
            !dismissedCallIds.has(c.id) &&
            c.callerId !== currentUserId &&
            c.caller?.id !== currentUserId,
        );
        if (!nextCall) return;

        if (nextCall.iceServers && nextCall.iceServers.length > 0) {
          iceServersByCall.set(nextCall.id, nextCall.iceServers);
        }

        if (get().incomingCall?.id !== nextCall.id) {
          ringtone.start();
          set({
            incomingCall: {
              id: nextCall.id,
              callType: nextCall.callType || CallType.AUDIO,
              conversationId: nextCall.conversationId,
              status: CallStatus.RINGING,
              isOutgoing: false,
              peerUsers: mapPeerUsersFromCallRecord(nextCall, currentUserId),
            },
          });
        }
      } catch {
        // Ignore transient polling errors
      } finally {
        incomingBusy = false;
      }
    };

    const pollActiveCall = async () => {
      if (cancelled || signalBusy || socketManager.isConnected) return;
      const currentActive = get().activeCall;
      const currentUserId = useAuthStore.getState().user?.id;
      if (!currentActive || !isValidCallId(currentActive.id) || !currentUserId) return;

      const callId = currentActive.id;
      signalBusy = true;
      signalTickCount += 1;

      try {
        const sigRes = await api.get(`/calls/${callId}/signals`);
        if (cancelled || get().activeCall?.id !== callId) return;
        const sigData = unwrapData<{ signals?: CallSignalRecord[] } | CallSignalRecord[]>(
          sigRes.data,
        );
        const signals = Array.isArray(sigData) ? sigData : sigData?.signals || [];

        for (const sig of signals) {
          if (cancelled || get().activeCall?.id !== callId) return;
          if (sig.fromUserId && sig.fromUserId === currentUserId) continue;

          if (sig.type === 'call_ended' || sig.type === 'call_rejected') {
            closeCallSession(callId);
            return;
          }

          if (sig.type === 'peer_joined' && sig.fromUserId) {
            markCallOngoing();
            if (!webrtcManager.hasPeerConnection(sig.fromUserId)) {
              await webrtcManager.createOfferForPeer(sig.fromUserId, callId);
            }
          } else if (sig.type === 'peer_left' && sig.fromUserId) {
            webrtcManager.removePeer(sig.fromUserId);
          } else if (sig.type === 'offer' && sig.fromUserId && (sig.offer || sig.sdp)) {
            markCallOngoing();
            await webrtcManager.handleOffer(sig.fromUserId, callId, (sig.offer || sig.sdp)!);
          } else if (sig.type === 'answer' && sig.fromUserId && (sig.answer || sig.sdp)) {
            markCallOngoing();
            await webrtcManager.handleAnswer(sig.fromUserId, (sig.answer || sig.sdp)!);
          } else if (
            (sig.type === 'ice-candidate' || sig.type === 'ice_candidate') &&
            sig.fromUserId &&
            sig.candidate
          ) {
            await webrtcManager.handleIceCandidate(sig.fromUserId, sig.candidate);
          }
        }

        if (signalTickCount % 2 === 0 && !cancelled && get().activeCall?.id === callId) {
          const callRes = await api.get(`/calls/${callId}`);
          if (cancelled || get().activeCall?.id !== callId) return;
          const details = unwrapData<CallRecordResponse>(callRes.data);
          if (!details) return;

          if (
            details.status === CallStatus.ENDED ||
            details.status === CallStatus.REJECTED ||
            details.status === CallStatus.MISSED
          ) {
            closeCallSession(callId);
            return;
          }

          if (details.status === CallStatus.ONGOING) {
            const latestActive = get().activeCall;
            const wasRinging = latestActive?.status === CallStatus.RINGING;
            markCallOngoing();

            if (
              (wasRinging || latestActive?.isOutgoing) &&
              Array.isArray(details.participants)
            ) {
              for (const p of details.participants) {
                if (
                  p.userId &&
                  p.userId !== currentUserId &&
                  !p.leftAt &&
                  !webrtcManager.hasPeerConnection(p.userId)
                ) {
                  await webrtcManager.createOfferForPeer(p.userId, callId);
                }
              }
            }
          }
        }
      } catch {
        // Ignore transient polling errors
      } finally {
        signalBusy = false;
      }
    };

    void pollIncoming();
    const incomingTimer = window.setInterval(() => {
      void pollIncoming();
    }, 2500);
    const activeTimer = window.setInterval(() => {
      void pollActiveCall();
    }, 800);

    return () => {
      cancelled = true;
      window.clearInterval(incomingTimer);
      window.clearInterval(activeTimer);
    };
  },
}));

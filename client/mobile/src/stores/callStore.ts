import { create } from 'zustand';
import { Call, CallStatus, CallType, SocketEvents } from '@whatsapp-pro/shared-types';
import api from '../services/api';
import socketService from '../services/socket';
import webrtcService, { WebRTCConnectionStatus } from '../services/webrtc';
import {
  extractErrorMessage,
  IncomingCallPayload,
  normalizeCall,
  unwrapApiData,
} from '../types/mobile.types';

interface CallState {
  callHistory: Call[];
  isLoadingHistory: boolean;
  incomingCall: IncomingCallPayload | null;
  activeCall: {
    callId: string;
    conversationId?: string | null;
    callType: CallType;
    peerName: string;
    peerAvatar?: string | null;
    status: CallStatus;
    isCaller: boolean;
    startedAt?: number;
  } | null;
  isMuted: boolean;
  isSpeakerOn: boolean;
  isVideoOn: boolean;
  isFrontCamera: boolean;
  localStream: any;
  remoteStreams: Record<string, any>;
  connectionStatus: WebRTCConnectionStatus;
  callError: string | null;
  listenersBound: boolean;

  bindSocketListeners: () => () => void;
  fetchCallHistory: () => Promise<void>;
  initiateCall: (params: {
    conversationId: string;
    callType: CallType;
    peerName: string;
    peerAvatar?: string | null;
    peerUserIds: string[];
  }) => Promise<string>;
  acceptIncomingCall: () => Promise<void>;
  rejectIncomingCall: () => Promise<void>;
  endActiveCall: () => Promise<void>;
  toggleMute: () => void;
  toggleSpeaker: () => void;
  toggleVideo: () => void;
  switchCamera: () => void;
  setIncomingCall: (payload: IncomingCallPayload | null) => void;
}

export const useCallStore = create<CallState>((set, get) => ({
  callHistory: [],
  isLoadingHistory: false,
  incomingCall: null,
  activeCall: null,
  isMuted: false,
  isSpeakerOn: false,
  isVideoOn: true,
  isFrontCamera: true,
  localStream: null,
  remoteStreams: {},
  connectionStatus: 'idle',
  callError: null,
  listenersBound: false,

  setIncomingCall: (incomingCall) => set({ incomingCall }),

  bindSocketListeners: () => {
    if (get().listenersBound) return () => {};
    set({ listenersBound: true });

    const unsubStreams = webrtcService.subscribe((localStream, remoteStreams, connectionStatus) => {
      set({ localStream, remoteStreams, connectionStatus });
    });

    const onIncoming = (raw: Record<string, any>) => {
      const callId = String(raw.callId ?? raw.id ?? '');
      if (!callId) return;
      const caller = raw.caller ?? {};
      set({
        incomingCall: {
          callId,
          callerId: String(raw.callerId ?? caller.id ?? ''),
          callerName: String(raw.callerName ?? caller.displayName ?? caller.display_name ?? 'Incoming Call'),
          callerAvatar: raw.callerAvatar ?? caller.avatarUrl ?? caller.avatar_url ?? null,
          conversationId: raw.conversationId ?? raw.conversation_id ?? null,
          callType: (raw.callType ?? raw.call_type ?? CallType.AUDIO) as CallType,
        },
      });
    };

    const onOffer = (payload: { callId: string; fromUserId: string; offer?: any; sdp?: any; callType?: CallType }) => {
      const offer = payload.offer ?? payload.sdp;
      if (!offer || !payload.callId || !payload.fromUserId) return;
      const active = get().activeCall;
      if (active && active.callId === payload.callId) {
        webrtcService
          .handleIncomingOffer({
            callId: payload.callId,
            fromUserId: payload.fromUserId,
            offer,
            callType: payload.callType ?? active.callType,
          })
          .catch((err) => {
            set({ callError: extractErrorMessage(err, 'Failed to process call offer') });
          });
      } else {
        webrtcService.queuePendingOffer({
          callId: payload.callId,
          fromUserId: payload.fromUserId,
          offer,
          callType: payload.callType ?? get().incomingCall?.callType,
        });
      }
    };

    const onAnswer = (payload: { callId: string; fromUserId: string; answer?: any; sdp?: any }) => {
      const answer = payload.answer ?? payload.sdp;
      if (answer) {
        webrtcService
          .handleIncomingAnswer({
            callId: payload.callId,
            fromUserId: payload.fromUserId,
            answer,
          })
          .catch((err) => {
            set({ callError: extractErrorMessage(err, 'Failed to process call answer') });
          });
      }
      set((s) =>
        s.activeCall && s.activeCall.callId === payload.callId
          ? {
              activeCall: {
                ...s.activeCall,
                status: CallStatus.ONGOING,
                startedAt: s.activeCall.startedAt ?? Date.now(),
              },
            }
          : s,
      );
    };

    const onIceCandidate = (payload: { callId?: string; fromUserId: string; candidate: any }) => {
      webrtcService.handleIncomingIceCandidate(payload).catch(() => {});
    };

    const onCallSignal = (payload: {
      callId: string;
      fromUserId?: string;
      type?: string;
      offer?: any;
      answer?: any;
      candidate?: any;
    }) => {
      if (!payload?.callId) return;
      if (payload.type === 'peer_joined') {
        const active = get().activeCall;
        if (active && active.callId === payload.callId) {
          set((s) =>
            s.activeCall && s.activeCall.callId === payload.callId
              ? {
                  activeCall: {
                    ...s.activeCall,
                    status: CallStatus.ONGOING,
                    startedAt: s.activeCall.startedAt ?? Date.now(),
                  },
                }
              : s,
          );
          if (payload.fromUserId) {
            webrtcService.createOfferForPeer(payload.callId, payload.fromUserId).catch(() => {});
          }
        }
      } else if (payload.type === 'offer' && payload.fromUserId && payload.offer) {
        onOffer({ callId: payload.callId, fromUserId: payload.fromUserId, offer: payload.offer });
      } else if (payload.type === 'answer' && payload.fromUserId && payload.answer) {
        onAnswer({ callId: payload.callId, fromUserId: payload.fromUserId, answer: payload.answer });
      } else if (
        (payload.type === 'ice_candidate' || payload.type === 'ice-candidate') &&
        payload.fromUserId &&
        payload.candidate
      ) {
        onIceCandidate({ callId: payload.callId, fromUserId: payload.fromUserId, candidate: payload.candidate });
      }
    };

    const onCallAccepted = (payload: { callId: string }) => {
      set((s) =>
        s.activeCall && s.activeCall.callId === payload.callId
          ? {
              activeCall: {
                ...s.activeCall,
                status: CallStatus.ONGOING,
                startedAt: s.activeCall.startedAt ?? Date.now(),
              },
            }
          : s,
      );
    };

    const onCallEnded = (payload: { callId: string }) => {
      const state = get();
      if (state.incomingCall?.callId === payload.callId) {
        set({ incomingCall: null });
      }
      if (state.activeCall?.callId === payload.callId) {
        webrtcService.endSession();
        set({ activeCall: null, callError: null, connectionStatus: 'idle' });
        get().fetchCallHistory().catch(() => {});
      }
    };

    const unsubs = [
      unsubStreams,
      socketService.on(SocketEvents.CALL_INCOMING, onIncoming),
      socketService.on('call_incoming', onIncoming),
      socketService.on('call_signal', onCallSignal),
      socketService.on(SocketEvents.WEBRTC_OFFER, onOffer),
      socketService.on('call_offer_received', onOffer),
      socketService.on(SocketEvents.WEBRTC_ANSWER, onAnswer),
      socketService.on('call_answer_received', onAnswer),
      socketService.on(SocketEvents.WEBRTC_ICE_CANDIDATE, onIceCandidate),
      socketService.on('ice_candidate_received', onIceCandidate),
      socketService.on(SocketEvents.CALL_ACCEPTED, onCallAccepted),
      socketService.on(SocketEvents.CALL_ENDED, onCallEnded),
      socketService.on('call_ended', onCallEnded),
      socketService.on('call_ended_notification', onCallEnded),
      socketService.on(SocketEvents.CALL_REJECTED, onCallEnded),
      socketService.on('call_rejected', onCallEnded),
    ];

    return () => {
      unsubs.forEach((fn) => fn());
      set({ listenersBound: false });
    };
  },

  fetchCallHistory: async () => {
    set({ isLoadingHistory: true });
    try {
      const res = await api.get('/calls/history', { params: { limit: 40 } });
      const data = unwrapApiData<{ items?: Record<string, unknown>[] } | Record<string, unknown>[]>(res.data);
      const list = Array.isArray(data) ? data : data?.items ?? [];
      set({ callHistory: list.map(normalizeCall) });
    } catch {
      // keep existing history
    } finally {
      set({ isLoadingHistory: false });
    }
  },

  initiateCall: async ({ conversationId, callType, peerName, peerAvatar, peerUserIds }) => {
    set({ callError: null });
    try {
      if (!socketService.isConnected()) {
        await socketService.connect().catch(() => {});
      }
      let res;
      try {
        res = await api.post('/calls', {
          conversationId,
          callType,
        });
      } catch (err: any) {
        const status = err?.response?.status;
        const msg = extractErrorMessage(err, '');
        const staleMatch = msg.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
        if (status === 409 && staleMatch?.[1]) {
          await api.post(`/calls/${staleMatch[1]}/end`).catch(() => {});
          res = await api.post('/calls', {
            conversationId,
            callType,
          });
        } else {
          throw err;
        }
      }
      const data = unwrapApiData<Record<string, any>>(res.data);
      const callObj = (data.call ?? data) as Record<string, any>;
      const callId = String(callObj.id ?? data.callId ?? '');
      const serverRecipients = Array.isArray(data.recipients)
        ? data.recipients.map((id: unknown) => String(id)).filter(Boolean)
        : [];
      const resolvedPeers = peerUserIds.length > 0 ? peerUserIds : serverRecipients;

      set({
        activeCall: {
          callId,
          conversationId,
          callType,
          peerName,
          peerAvatar,
          status: CallStatus.RINGING,
          isCaller: true,
        },
        isMuted: false,
        isSpeakerOn: callType === CallType.VIDEO,
        isVideoOn: callType === CallType.VIDEO,
        isFrontCamera: true,
        callError: null,
      });

      webrtcService.setSpeakerEnabled(callType === CallType.VIDEO);
      await webrtcService.startCall(callId, callType, resolvedPeers);
      return callId;
    } catch (err) {
      webrtcService.endSession();
      set({ activeCall: null, connectionStatus: 'idle' });
      throw new Error(extractErrorMessage(err, 'Could not start call'));
    }
  },

  acceptIncomingCall: async () => {
    const incoming = get().incomingCall;
    if (!incoming) return;

    set({
      incomingCall: null,
      activeCall: {
        callId: incoming.callId,
        conversationId: incoming.conversationId,
        callType: incoming.callType,
        peerName: incoming.callerName,
        peerAvatar: incoming.callerAvatar,
        status: CallStatus.ONGOING,
        isCaller: false,
        startedAt: Date.now(),
      },
      isMuted: false,
      isSpeakerOn: incoming.callType === CallType.VIDEO,
      isVideoOn: incoming.callType === CallType.VIDEO,
      isFrontCamera: true,
      callError: null,
    });

    try {
      webrtcService.setSpeakerEnabled(incoming.callType === CallType.VIDEO);
      await webrtcService.loadIceServers();
      try {
        await webrtcService.startLocalMedia(incoming.callType);
      } catch (mediaErr) {
        set({
          callError: extractErrorMessage(
            mediaErr,
            'Microphone or camera access was denied for this call.',
          ),
        });
      }

      if (!socketService.isConnected()) {
        await socketService.connect().catch(() => {});
      }
      if (socketService.isConnected()) {
        socketService.emit('call_join', { callId: incoming.callId });
      } else {
        await api.post(`/calls/${incoming.callId}/join`).catch(() => {});
      }

      await webrtcService.flushPendingSignalsForCall(incoming.callId);
    } catch (err) {
      set({
        callError: extractErrorMessage(err, 'Could not establish call connection.'),
      });
    }
  },

  rejectIncomingCall: async () => {
    const incoming = get().incomingCall;
    if (!incoming) return;
    set({ incomingCall: null, callError: null });
    try {
      socketService.emit(SocketEvents.CALL_REJECT, { callId: incoming.callId });
      socketService.emit('call_reject', { callId: incoming.callId });
      await api.post(`/calls/${incoming.callId}/reject`);
    } catch {
      // ignore
    }
  },

  endActiveCall: async () => {
    const active = get().activeCall;
    webrtcService.endSession();
    set({ activeCall: null, callError: null, connectionStatus: 'idle' });
    if (!active) return;

    try {
      socketService.emit(SocketEvents.CALL_END, { callId: active.callId });
      socketService.emit('call_end', { callId: active.callId });
      await api.post(`/calls/${active.callId}/end`);
    } catch {
      // ignore
    } finally {
      get().fetchCallHistory().catch(() => {});
    }
  },

  toggleMute: () => {
    const next = !get().isMuted;
    webrtcService.setAudioMuted(next);
    set({ isMuted: next });
  },

  toggleSpeaker: () => {
    const next = !get().isSpeakerOn;
    webrtcService.setSpeakerEnabled(next);
    set({ isSpeakerOn: next });
  },

  toggleVideo: () => {
    const next = !get().isVideoOn;
    webrtcService.setVideoEnabled(next);
    set({ isVideoOn: next });
  },

  switchCamera: () => {
    webrtcService.switchCamera();
    set((s) => ({ isFrontCamera: !s.isFrontCamera }));
  },
}));

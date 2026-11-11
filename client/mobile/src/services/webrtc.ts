import { PermissionsAndroid, Platform } from 'react-native';
import { CallType, SocketEvents } from '@whatsapp-pro/shared-types';
import api from './api';
import socketService from './socket';
import { unwrapApiData } from '../types/mobile.types';

/**
 * Conditional wrapper around `react-native-webrtc` so the app runs cleanly
 * in Expo Dev Client (full WebRTC) as well as Expo Go / Web without native crash.
 */
interface RNWebRTCModule {
  RTCPeerConnection: any;
  RTCIceCandidate: any;
  RTCSessionDescription: any;
  MediaStream?: any;
  mediaDevices: {
    getUserMedia: (constraints: any) => Promise<any>;
  };
  RTCView?: any;
}

let rnWebRtc: RNWebRTCModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  rnWebRtc = require('react-native-webrtc');
} catch {
  rnWebRtc = null;
}

export const RTCViewComponent = rnWebRtc?.RTCView ?? null;

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

const DEFAULT_ICE_SERVERS: IceServerConfig[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export type WebRTCConnectionStatus = 'idle' | 'connecting' | 'connected' | 'failed';
export type WebRTCStreamsListener = (
  localStream: any,
  remoteStreams: Record<string, any>,
  connectionStatus: WebRTCConnectionStatus,
) => void;

class MobileWebRTCService {
  private peerConnections = new Map<string, any>();
  private localStream: any = null;
  private remoteStreams: Record<string, any> = {};
  private currentCallId: string | null = null;
  private listeners = new Set<WebRTCStreamsListener>();
  private iceServers: IceServerConfig[] = DEFAULT_ICE_SERVERS;
  private hasTurnRelay = false;
  private isSpeakerOn = false;
  private connectionStatus: WebRTCConnectionStatus = 'idle';
  private pendingOffers = new Map<string, { callId: string; fromUserId: string; offer: any; callType?: CallType }>();
  private pendingIceByPeer = new Map<string, { callId: string; fromUserId: string; candidate: any }[]>();

  isNativeWebRTCAvailable(): boolean {
    return Boolean(rnWebRtc?.RTCPeerConnection && rnWebRtc?.mediaDevices);
  }

  hasPeer(peerId: string): boolean {
    return this.peerConnections.has(peerId);
  }

  hasTurnServer(): boolean {
    return this.hasTurnRelay;
  }

  private async ensureMediaPermissions(callType: CallType): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    try {
      const perms = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
      if (callType === CallType.VIDEO) {
        perms.push(PermissionsAndroid.PERMISSIONS.CAMERA);
      }
      const results = await PermissionsAndroid.requestMultiple(perms);
      const audioOk = results[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED;
      const cameraOk =
        callType !== CallType.VIDEO ||
        results[PermissionsAndroid.PERMISSIONS.CAMERA] === PermissionsAndroid.RESULTS.GRANTED;
      return audioOk && cameraOk;
    } catch {
      return false;
    }
  }

  subscribe(listener: WebRTCStreamsListener): () => void {
    this.listeners.add(listener);
    listener(this.localStream, { ...this.remoteStreams }, this.connectionStatus);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners() {
    this.listeners.forEach((cb) => {
      cb(this.localStream, { ...this.remoteStreams }, this.connectionStatus);
    });
  }

  private setConnectionStatus(status: WebRTCConnectionStatus) {
    if (this.connectionStatus !== status) {
      this.connectionStatus = status;
      this.notifyListeners();
    }
  }

  async loadIceServers(): Promise<IceServerConfig[]> {
    try {
      const res = await api.get('/calls/ice-servers');
      const data = unwrapApiData<
        IceServerConfig[] | { iceServers: IceServerConfig[]; hasTurn?: boolean }
      >(res.data);
      const list = Array.isArray(data) ? data : data?.iceServers;
      if (Array.isArray(list) && list.length > 0) {
        this.iceServers = list;
      }
      this.hasTurnRelay =
        (!Array.isArray(data) && Boolean(data?.hasTurn)) ||
        this.iceServers.some((srv) => {
          const urls = Array.isArray(srv.urls) ? srv.urls : [srv.urls];
          return urls.some((u) => typeof u === 'string' && /^turns?:/i.test(u));
        });
    } catch {
      this.iceServers = DEFAULT_ICE_SERVERS;
      this.hasTurnRelay = false;
    }
    return this.iceServers;
  }

  async startLocalMedia(callType: CallType): Promise<any> {
    if (!rnWebRtc?.mediaDevices) return null;
    if (this.localStream) return this.localStream;

    const granted = await this.ensureMediaPermissions(callType);
    if (!granted) {
      throw new Error(
        callType === CallType.VIDEO
          ? 'Camera and microphone permissions are required for video calls.'
          : 'Microphone permission is required for voice calls.',
      );
    }

    const stream = await rnWebRtc.mediaDevices.getUserMedia({
      audio: true,
      video:
        callType === CallType.VIDEO
          ? {
              facingMode: 'user',
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30 },
            }
          : false,
    });
    this.localStream = stream;
    this.notifyListeners();
    return stream;
  }

  async startCall(callId: string, callType: CallType, peerUserIds: string[]) {
    this.currentCallId = callId;
    this.setConnectionStatus('connecting');
    await this.loadIceServers();
    await this.startLocalMedia(callType);
    socketService.emit('call_join', { callId });

    for (const peerId of peerUserIds) {
      await this.createOfferForPeer(callId, peerId);
    }
  }

  queuePendingOffer(payload: { callId: string; fromUserId: string; offer: any; callType?: CallType }) {
    if (!payload.callId || !payload.fromUserId || !payload.offer) return;
    this.pendingOffers.set(`${payload.callId}:${payload.fromUserId}`, payload);
  }

  async flushPendingSignalsForCall(callId: string) {
    const matchingOffers = Array.from(this.pendingOffers.entries()).filter(
      ([key]) => key.startsWith(`${callId}:`),
    );
    for (const [key, offerPayload] of matchingOffers) {
      this.pendingOffers.delete(key);
      await this.handleIncomingOffer(offerPayload);
    }
  }

  private async drainPendingIce(callId: string, peerId: string) {
    const queue = this.pendingIceByPeer.get(peerId) ?? [];
    if (queue.length === 0) return;
    const remaining: { callId: string; fromUserId: string; candidate: any }[] = [];
    for (const item of queue) {
      if (item.callId && item.callId !== callId) {
        remaining.push(item);
        continue;
      }
      await this.handleIncomingIceCandidate(item);
    }
    if (remaining.length > 0) {
      this.pendingIceByPeer.set(peerId, remaining);
    } else {
      this.pendingIceByPeer.delete(peerId);
    }
  }

  private getOrCreatePeerConnection(callId: string, peerId: string): any {
    if (!rnWebRtc?.RTCPeerConnection) return null;
    const existing = this.peerConnections.get(peerId);
    if (existing) return existing;

    const pc = new rnWebRtc.RTCPeerConnection({ iceServers: this.iceServers });

    if (this.localStream) {
      this.localStream.getTracks().forEach((track: any) => {
        pc.addTrack(track, this.localStream);
      });
    }

    pc.onicecandidate = (event: any) => {
      if (event.candidate) {
        const payload = {
          callId,
          toUserId: peerId,
          candidate: event.candidate,
        };
        socketService.emit('ice_candidate', payload);
      }
    };

    const updateStateFromPc = () => {
      const iceState: string | undefined = pc.iceConnectionState;
      const connState: string | undefined = pc.connectionState;
      if (
        connState === 'connected' ||
        iceState === 'connected' ||
        iceState === 'completed'
      ) {
        this.setConnectionStatus('connected');
      } else if (connState === 'failed' || iceState === 'failed') {
        this.setConnectionStatus('failed');
      } else if (
        iceState === 'checking' ||
        iceState === 'disconnected' ||
        connState === 'connecting'
      ) {
        if (this.connectionStatus !== 'connected') {
          this.setConnectionStatus('connecting');
        }
      }
    };

    pc.oniceconnectionstatechange = updateStateFromPc;
    pc.onconnectionstatechange = updateStateFromPc;

    pc.ontrack = (event: any) => {
      const streamFromEvent = event.streams?.[0];
      if (streamFromEvent) {
        this.remoteStreams[peerId] = streamFromEvent;
        this.notifyListeners();
      } else if (event.track && rnWebRtc?.MediaStream) {
        const currentStream = this.remoteStreams[peerId] ?? new rnWebRtc.MediaStream([]);
        const alreadyHasTrack =
          typeof currentStream.getTracks === 'function' &&
          currentStream.getTracks().some((t: any) => t.id === event.track.id);
        if (!alreadyHasTrack && typeof currentStream.addTrack === 'function') {
          currentStream.addTrack(event.track);
        }
        this.remoteStreams[peerId] = currentStream;
        this.notifyListeners();
      }
    };

    pc.onaddstream = (event: any) => {
      if (event.stream) {
        this.remoteStreams[peerId] = event.stream;
        this.notifyListeners();
      }
    };

    this.peerConnections.set(peerId, pc);
    return pc;
  }

  async createOfferForPeer(callId: string, peerId: string) {
    if (!peerId) return;
    if (this.connectionStatus === 'idle') {
      this.setConnectionStatus('connecting');
    }
    const pc = this.getOrCreatePeerConnection(callId, peerId);
    if (!pc) return;
    if (
      pc.signalingState === 'have-local-offer' &&
      pc.localDescription &&
      !pc.remoteDescription
    ) {
      socketService.emit('call_offer', { callId, toUserId: peerId, offer: pc.localDescription });
      return;
    }
    if (pc.signalingState && pc.signalingState !== 'stable') return;
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await pc.setLocalDescription(offer);
    const payload = { callId, toUserId: peerId, offer };
    socketService.emit('call_offer', payload);
  }

  async handleIncomingOffer(payload: { callId: string; fromUserId: string; offer: any; callType?: CallType }) {
    if (!payload.offer || !payload.fromUserId) return;
    this.currentCallId = payload.callId;
    if (this.connectionStatus === 'idle') {
      this.setConnectionStatus('connecting');
    }
    await this.loadIceServers();
    if (!this.localStream) {
      await this.startLocalMedia(payload.callType ?? CallType.VIDEO);
    }
    const pc = this.getOrCreatePeerConnection(payload.callId, payload.fromUserId);
    if (!pc || !rnWebRtc) return;

    // Ignore duplicate identical offers that arrive alongside peer_joined retries
    if (
      pc.remoteDescription?.sdp &&
      payload.offer?.sdp &&
      pc.remoteDescription.sdp === payload.offer.sdp
    ) {
      if (pc.localDescription && this.connectionStatus !== 'connected') {
        socketService.emit('call_answer', {
          callId: payload.callId,
          toUserId: payload.fromUserId,
          answer: pc.localDescription,
        });
      }
      return;
    }

    if (pc.signalingState === 'have-local-offer') {
      // Offer glare recovery: politely roll back local offer if needed
      try {
        await pc.setLocalDescription({ type: 'rollback' });
      } catch {
        // Older react-native-webrtc may not support rollback; continue carefully
      }
    }

    await pc.setRemoteDescription(new rnWebRtc.RTCSessionDescription(payload.offer));
    await this.drainPendingIce(payload.callId, payload.fromUserId);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    const reply = { callId: payload.callId, toUserId: payload.fromUserId, answer };
    socketService.emit('call_answer', reply);
  }

  async handleIncomingAnswer(payload: { callId: string; fromUserId: string; answer: any }) {
    const pc = this.peerConnections.get(payload.fromUserId);
    if (!pc || !rnWebRtc || !payload.answer) return;
    if (pc.signalingState === 'have-local-offer') {
      await pc.setRemoteDescription(new rnWebRtc.RTCSessionDescription(payload.answer));
      await this.drainPendingIce(payload.callId, payload.fromUserId);
    }
  }

  async handleIncomingIceCandidate(payload: { callId?: string; fromUserId: string; candidate: any }) {
    if (!payload.candidate || !payload.fromUserId) return;
    const pc = this.peerConnections.get(payload.fromUserId);
    if (!pc || !pc.remoteDescription || !rnWebRtc) {
      const existing = this.pendingIceByPeer.get(payload.fromUserId) ?? [];
      existing.push({
        callId: payload.callId ?? this.currentCallId ?? '',
        fromUserId: payload.fromUserId,
        candidate: payload.candidate,
      });
      this.pendingIceByPeer.set(payload.fromUserId, existing);
      return;
    }
    try {
      await pc.addIceCandidate(new rnWebRtc.RTCIceCandidate(payload.candidate));
    } catch {
      // Ignore stale candidate errors
    }
  }

  setAudioMuted(muted: boolean) {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track: any) => {
        track.enabled = !muted;
      });
    }
    if (this.currentCallId) {
      socketService.emit('call_toggle_mute', {
        callId: this.currentCallId,
        isMuted: muted,
      });
      socketService.emit(SocketEvents.CALL_TOGGLE_MUTE, {
        callId: this.currentCallId,
        isMuted: muted,
      });
    }
  }

  setVideoEnabled(enabled: boolean) {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach((track: any) => {
        track.enabled = enabled;
      });
    }
    if (this.currentCallId) {
      socketService.emit('call_toggle_video', {
        callId: this.currentCallId,
        isVideoOn: enabled,
      });
      socketService.emit(SocketEvents.CALL_TOGGLE_VIDEO, {
        callId: this.currentCallId,
        isVideoOn: enabled,
      });
    }
  }

  switchCamera() {
    if (!this.localStream) return;
    this.localStream.getVideoTracks().forEach((track: any) => {
      if (typeof track._switchCamera === 'function') {
        track._switchCamera();
      }
    });
  }

  setSpeakerEnabled(enabled: boolean) {
    this.isSpeakerOn = enabled;
    // Expo AV audio routing fallback for speakerphone when InCallManager isn't linked
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Audio } = require('expo-av');
      Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: !enabled,
      }).catch(() => {});
    } catch {
      // ignore
    }
  }

  getSpeakerEnabled(): boolean {
    return this.isSpeakerOn;
  }

  endSession() {
    this.pendingOffers.clear();
    this.pendingIceByPeer.clear();
    this.peerConnections.forEach((pc) => {
      try {
        pc.close();
      } catch {
        // ignore
      }
    });
    this.peerConnections.clear();

    if (this.localStream) {
      this.localStream.getTracks().forEach((track: any) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      this.localStream = null;
    }

    this.remoteStreams = {};
    this.currentCallId = null;
    this.connectionStatus = 'idle';
    this.notifyListeners();
  }
}

export const webrtcService = new MobileWebRTCService();
export default webrtcService;

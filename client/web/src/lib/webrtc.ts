import { api, unwrapData } from './api';
import { socketManager } from './socket';

export interface ConnectionQualityStats {
  quality: 'good' | 'fair' | 'poor';
  rttMs?: number;
  packetLossPct?: number;
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

type RemoteStreamHandler = (peerUserId: string, stream: MediaStream) => void;
type PeerRemovedHandler = (peerUserId: string) => void;
type QualityHandler = (stats: ConnectionQualityStats) => void;

class WebRTCManager {
  private peers = new Map<string, RTCPeerConnection>();
  private pendingIceByPeer = new Map<string, RTCIceCandidateInit[]>();
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private iceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS;
  private statsInterval: number | null = null;

  private onRemoteStream: RemoteStreamHandler | null = null;
  private onPeerRemoved: PeerRemovedHandler | null = null;
  private onQualityUpdate: QualityHandler | null = null;

  setHandlers(handlers: {
    onRemoteStream?: RemoteStreamHandler;
    onPeerRemoved?: PeerRemovedHandler;
    onQualityUpdate?: QualityHandler;
  }) {
    if (handlers.onRemoteStream) this.onRemoteStream = handlers.onRemoteStream;
    if (handlers.onPeerRemoved) this.onPeerRemoved = handlers.onPeerRemoved;
    if (handlers.onQualityUpdate) this.onQualityUpdate = handlers.onQualityUpdate;
  }

  async fetchIceServers(): Promise<RTCIceServer[]> {
    try {
      const res = await api.get('/calls/ice-servers');
      const data = unwrapData<RTCIceServer[] | { iceServers: RTCIceServer[] }>(res.data);
      const servers = Array.isArray(data) ? data : data?.iceServers;
      if (servers && servers.length > 0) {
        this.iceServers = servers;
      }
    } catch {
      this.iceServers = DEFAULT_ICE_SERVERS;
    }
    return this.iceServers;
  }

  async startLocalMedia(video: boolean): Promise<MediaStream> {
    if (this.localStream) {
      const hasVideo = this.localStream.getVideoTracks().length > 0;
      if (hasVideo === video) return this.localStream;
      this.stopLocalMedia();
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: video
        ? {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user',
          }
        : false,
    });
    this.localStream = stream;
    return stream;
  }

  stopLocalMedia() {
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.stopScreenShare();
  }

  hasPeerConnection(peerUserId: string): boolean {
    const pc = this.peers.get(peerUserId);
    return Boolean(pc && pc.connectionState !== 'closed' && pc.connectionState !== 'failed');
  }

  hasPeer(peerUserId: string): boolean {
    return this.hasPeerConnection(peerUserId);
  }

  private sendSignal(
    callId: string,
    toUserId: string,
    data: {
      type: 'offer' | 'answer' | 'ice-candidate';
      sdp?: RTCSessionDescriptionInit;
      offer?: RTCSessionDescriptionInit;
      answer?: RTCSessionDescriptionInit;
      candidate?: RTCIceCandidateInit;
    },
  ) {
    if (socketManager.isConnected) {
      if (data.type === 'offer') {
        socketManager.emit('call_offer', {
          callId,
          toUserId,
          sdp: data.sdp || data.offer,
          offer: data.offer || data.sdp,
        });
      } else if (data.type === 'answer') {
        socketManager.emit('call_answer', {
          callId,
          toUserId,
          sdp: data.sdp || data.answer,
          answer: data.answer || data.sdp,
        });
      } else if (data.type === 'ice-candidate' && data.candidate) {
        socketManager.emit('ice_candidate', {
          callId,
          toUserId,
          candidate: data.candidate,
        });
      }
      return;
    }

    void api
      .post(`/calls/${callId}/signal`, {
        toUserId,
        ...data,
      })
      .catch((err) => {
        console.warn('[WebRTC] HTTP signal delivery failed:', err);
      });
  }

  async initCall(
    callId: string,
    video: boolean,
    iceServersOverride?: RTCIceServer[],
  ): Promise<MediaStream> {
    if (iceServersOverride && iceServersOverride.length > 0) {
      this.iceServers = iceServersOverride;
    } else {
      await this.fetchIceServers();
    }
    const stream = await this.startLocalMedia(video);
    if (socketManager.isConnected) {
      socketManager.emit('call_join', { callId });
    }
    this.startStatsMonitoring();
    return stream;
  }

  private createPeerConnection(peerUserId: string, callId: string): RTCPeerConnection {
    const existing = this.peers.get(peerUserId);
    if (existing) {
      existing.close();
    }

    const pc = new RTCPeerConnection({ iceServers: this.iceServers });

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.localStream!);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal(callId, peerUserId, {
          type: 'ice-candidate',
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (remoteStream) {
        this.onRemoteStream?.(peerUserId, remoteStream);
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.removePeer(peerUserId);
      }
    };

    this.peers.set(peerUserId, pc);
    return pc;
  }

  async createOfferForPeer(peerUserId: string, callId: string) {
    const pc = this.createPeerConnection(peerUserId, callId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.sendSignal(callId, peerUserId, {
      type: 'offer',
      sdp: offer,
      offer,
    });
  }

  private async flushPendingIceForPeer(peerUserId: string, pc: RTCPeerConnection) {
    const queued = this.pendingIceByPeer.get(peerUserId);
    if (!queued || queued.length === 0) return;
    this.pendingIceByPeer.delete(peerUserId);
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn('[WebRTC] Failed to add queued ICE candidate:', err);
      }
    }
  }

  async handleOffer(peerUserId: string, callId: string, sdp: RTCSessionDescriptionInit) {
    const existing = this.peers.get(peerUserId);
    if (
      existing &&
      existing.connectionState !== 'failed' &&
      existing.connectionState !== 'closed' &&
      ((existing.signalingState === 'stable' && Boolean(existing.remoteDescription)) ||
        existing.signalingState === 'have-remote-offer')
    ) {
      return;
    }

    const pc = this.createPeerConnection(peerUserId, callId);
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await this.flushPendingIceForPeer(peerUserId, pc);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    this.sendSignal(callId, peerUserId, {
      type: 'answer',
      sdp: answer,
      answer,
    });
  }

  async handleAnswer(peerUserId: string, sdp: RTCSessionDescriptionInit) {
    const pc = this.peers.get(peerUserId);
    if (!pc || pc.signalingState !== 'have-local-offer') return;
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await this.flushPendingIceForPeer(peerUserId, pc);
  }

  async handleIceCandidate(peerUserId: string, candidate: RTCIceCandidateInit) {
    const pc = this.peers.get(peerUserId);
    if (!pc || !pc.remoteDescription) {
      const existing = this.pendingIceByPeer.get(peerUserId) || [];
      existing.push(candidate);
      this.pendingIceByPeer.set(peerUserId, existing);
      return;
    }
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn('[WebRTC] Failed to add ICE candidate:', err);
    }
  }

  setAudioMuted(muted: boolean) {
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  setVideoEnabled(enabled: boolean) {
    this.localStream?.getVideoTracks().forEach((track) => {
      track.enabled = enabled;
    });
  }

  async startScreenShare(): Promise<MediaStream | null> {
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      this.screenStream = screen;
      const screenTrack = screen.getVideoTracks()[0];

      for (const pc of this.peers.values()) {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender && screenTrack) {
          await sender.replaceTrack(screenTrack);
        }
      }

      screenTrack.onended = () => {
        void this.stopScreenShare();
      };

      return screen;
    } catch {
      return null;
    }
  }

  async stopScreenShare() {
    if (!this.screenStream) return;
    this.screenStream.getTracks().forEach((t) => t.stop());
    this.screenStream = null;

    const camTrack = this.localStream?.getVideoTracks()[0];
    if (camTrack) {
      for (const pc of this.peers.values()) {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) {
          await sender.replaceTrack(camTrack);
        }
      }
    }
  }

  removePeer(peerUserId: string) {
    this.pendingIceByPeer.delete(peerUserId);
    const pc = this.peers.get(peerUserId);
    if (pc) {
      pc.close();
      this.peers.delete(peerUserId);
      this.onPeerRemoved?.(peerUserId);
    }
  }

  cleanup() {
    if (this.statsInterval) {
      window.clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    this.pendingIceByPeer.clear();
    this.peers.forEach((pc) => pc.close());
    this.peers.clear();
    this.stopLocalMedia();
  }

  private startStatsMonitoring() {
    if (this.statsInterval) window.clearInterval(this.statsInterval);
    this.statsInterval = window.setInterval(async () => {
      const firstPc = this.peers.values().next().value as RTCPeerConnection | undefined;
      if (!firstPc) return;
      try {
        const report = await firstPc.getStats();
        let rttMs: number | undefined;
        let packetsLost = 0;
        let packetsReceived = 0;
        report.forEach((stat) => {
          if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && typeof stat.currentRoundTripTime === 'number') {
            rttMs = Math.round(stat.currentRoundTripTime * 1000);
          }
          if (stat.type === 'inbound-rtp') {
            packetsLost += stat.packetsLost || 0;
            packetsReceived += stat.packetsReceived || 0;
          }
        });
        const total = packetsLost + packetsReceived;
        const lossPct = total > 0 ? Math.round((packetsLost / total) * 100) : 0;
        let quality: 'good' | 'fair' | 'poor' = 'good';
        if ((rttMs && rttMs > 300) || lossPct > 5) quality = 'poor';
        else if ((rttMs && rttMs > 150) || lossPct > 1) quality = 'fair';
        this.onQualityUpdate?.({ quality, rttMs, packetLossPct: lossPct });
      } catch {
        // Ignore stats error
      }
    }, 3000);
  }
}

export const webrtcManager = new WebRTCManager();

import React, { useEffect, useState } from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { CallStatus, CallType } from '@whatsapp-pro/shared-types';
import { useCallStore } from '../../stores/callStore';
import webrtcService, { RTCViewComponent } from '../../services/webrtc';
import { RootStackParamList } from '../../types/mobile.types';
import { Avatar } from '../../components/Avatar';

type Props = NativeStackScreenProps<RootStackParamList, 'ActiveCall'>;

export function ActiveCallScreen({ route, navigation }: Props) {
  const { callType, peerName, peerAvatar } = route.params;
  const {
    activeCall,
    isMuted,
    isSpeakerOn,
    isVideoOn,
    localStream,
    remoteStreams,
    connectionStatus,
    callError,
    toggleMute,
    toggleSpeaker,
    toggleVideo,
    switchCamera,
    endActiveCall,
  } = useCallStore();

  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!activeCall) {
      navigation.goBack();
      return;
    }
    const interval = setInterval(() => {
      if (activeCall.startedAt) {
        setElapsed(Math.floor((Date.now() - activeCall.startedAt) / 1000));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [activeCall, navigation]);

  const remoteStreamList = Object.values(remoteStreams);
  const firstRemote = remoteStreamList[0];

  const getStreamUrl = (stream: any): string | null => {
    try {
      if (stream && typeof stream.toURL === 'function') {
        const url = stream.toURL();
        return typeof url === 'string' && url.length > 0 ? url : null;
      }
    } catch {
      // ignore stream serialization issues
    }
    return null;
  };

  const remoteStreamUrl = getStreamUrl(firstRemote);
  const localStreamUrl = getStreamUrl(localStream);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const mediaHint = callError
    ? callError
    : connectionStatus === 'failed'
      ? webrtcService.hasTurnServer()
        ? 'Call media connection failed — check internet connectivity'
        : 'ICE/NAT blocked — configure TURN relay on backend for cross-network calls'
      : activeCall?.status === CallStatus.ONGOING && connectionStatus !== 'connected'
        ? 'Connecting audio/video...'
        : null;
  const statusLabel =
    activeCall?.status === CallStatus.ONGOING
      ? connectionStatus === 'connected' || remoteStreamUrl
        ? `${mins}:${secs < 10 ? '0' : ''}${secs}`
        : `Connecting (${mins}:${secs < 10 ? '0' : ''}${secs})`
      : activeCall?.status === CallStatus.RINGING
        ? 'Ringing...'
        : 'Connecting...';

  const handleHangup = async () => {
    await endActiveCall();
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Remote Video Stream when available */}
      {callType === CallType.VIDEO && RTCViewComponent && remoteStreamUrl ? (
        <RTCViewComponent
          streamURL={remoteStreamUrl}
          style={styles.remoteVideo}
          objectFit="cover"
        />
      ) : (
        <View style={styles.audioStage}>
          <Text style={styles.e2eeTag}>🔒 End-to-end encrypted</Text>
          <Avatar uri={peerAvatar} name={peerName} size={118} />
          <Text style={styles.peerName}>{activeCall?.peerName || peerName || 'Call'}</Text>
          <Text style={styles.statusText}>{statusLabel}</Text>
          {mediaHint ? (
            <Text style={[styles.statusText, { marginTop: 8, fontSize: 12, textAlign: 'center', paddingHorizontal: 24, color: callError || connectionStatus === 'failed' ? '#FCA5A5' : '#9CA3AF' }]}>
              {mediaHint}
            </Text>
          ) : null}
          {callType === CallType.VIDEO && !RTCViewComponent ? (
            <Text style={[styles.statusText, { marginTop: 8, fontSize: 12 }]}>
              Video preview unavailable in current runtime
            </Text>
          ) : null}
        </View>
      )}

      {/* Local Picture-in-Picture video preview */}
      {callType === CallType.VIDEO && isVideoOn && RTCViewComponent && localStreamUrl ? (
        <RTCViewComponent
          streamURL={localStreamUrl}
          style={styles.localPip}
          objectFit="cover"
          mirror
        />
      ) : null}

      {/* Top info bar for active video */}
      {callType === CallType.VIDEO && remoteStreamUrl ? (
        <View style={styles.videoOverlayHeader}>
          <Text style={styles.peerNameSmall}>{activeCall?.peerName || peerName}</Text>
          <Text style={styles.statusText}>{statusLabel}</Text>
        </View>
      ) : null}

      {/* Controls Bar */}
      <View style={styles.controlsBar}>
        <ControlBtn
          icon={isSpeakerOn ? 'volume-high' : 'volume-medium'}
          label="Speaker"
          active={isSpeakerOn}
          onPress={toggleSpeaker}
        />
        {callType === CallType.VIDEO && (
          <>
            <ControlBtn
              icon={isVideoOn ? 'videocam' : 'videocam-off'}
              label="Video"
              active={!isVideoOn}
              onPress={toggleVideo}
            />
            <ControlBtn
              icon="camera-reverse"
              label="Flip"
              onPress={switchCamera}
            />
          </>
        )}
        <ControlBtn
          icon={isMuted ? 'mic-off' : 'mic'}
          label="Mute"
          active={isMuted}
          onPress={toggleMute}
        />
        <TouchableOpacity style={styles.endBtn} onPress={handleHangup}>
          <Ionicons name="call" size={28} color="#FFFFFF" style={{ transform: [{ rotate: '135deg' }] }} />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function ControlBtn({
  icon,
  label,
  active,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.controlWrap} onPress={onPress}>
      <View style={[styles.controlCircle, active && styles.controlCircleActive]}>
        <Ionicons name={icon} size={24} color={active ? '#111B21' : '#FFFFFF'} />
      </View>
      <Text style={styles.controlLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B141A', justifyContent: 'space-between' },
  remoteVideo: { ...StyleSheet.absoluteFillObject },
  localPip: {
    position: 'absolute',
    top: 56,
    right: 16,
    width: 110,
    height: 155,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  videoOverlayHeader: { alignItems: 'center', marginTop: 24 },
  audioStage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  e2eeTag: { color: '#8696A0', fontSize: 13, marginBottom: 14 },
  peerName: { color: '#FFFFFF', fontSize: 26, fontWeight: '700', marginTop: 10 },
  peerNameSmall: { color: '#FFFFFF', fontSize: 19, fontWeight: '700' },
  statusText: { color: '#D1D5DB', fontSize: 15 },
  controlsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    backgroundColor: 'rgba(17, 27, 33, 0.88)',
    paddingVertical: 18,
    paddingHorizontal: 12,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  controlWrap: { alignItems: 'center', gap: 6 },
  controlCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlCircleActive: { backgroundColor: '#FFFFFF' },
  controlLabel: { color: '#E5E7EB', fontSize: 11 },
  endBtn: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#EA0038',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

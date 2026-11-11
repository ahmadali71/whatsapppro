import React from 'react';
import { Modal, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { CallType } from '@whatsapp-pro/shared-types';
import { useCallStore } from '../../stores/callStore';
import { Avatar } from '../../components/Avatar';

interface Props {
  onAccepted: (params: {
    callId: string;
    conversationId?: string | null;
    callType: CallType;
    peerName: string;
    peerAvatar?: string | null;
  }) => void;
}

export function IncomingCallScreen({ onAccepted }: Props) {
  const { incomingCall, acceptIncomingCall, rejectIncomingCall } = useCallStore();

  if (!incomingCall) return null;

  const handleAccept = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const snapshot = incomingCall;
    await acceptIncomingCall();
    onAccepted({
      callId: snapshot.callId,
      conversationId: snapshot.conversationId,
      callType: snapshot.callType,
      peerName: snapshot.callerName,
      peerAvatar: snapshot.callerAvatar,
    });
  };

  const handleReject = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    await rejectIncomingCall();
  };

  return (
    <Modal visible={Boolean(incomingCall)} animationType="slide" statusBarTranslucent>
      <SafeAreaView style={styles.container}>
        <View style={styles.top}>
          <Text style={styles.callLabel}>
            {incomingCall.callType === CallType.VIDEO ? 'WHATSAPP PRO VIDEO CALL' : 'WHATSAPP PRO VOICE CALL'}
          </Text>
          <Avatar uri={incomingCall.callerAvatar} name={incomingCall.callerName} size={120} />
          <Text style={styles.callerName}>{incomingCall.callerName}</Text>
          <Text style={styles.encrypted}>🔒 End-to-end encrypted</Text>
        </View>

        <View style={styles.actionsRow}>
          <View style={styles.btnCol}>
            <TouchableOpacity style={[styles.circleBtn, styles.declineBtn]} onPress={handleReject}>
              <Ionicons
                name="call"
                size={30}
                color="#FFFFFF"
                style={{ transform: [{ rotate: '135deg' }] }}
              />
            </TouchableOpacity>
            <Text style={styles.btnText}>Decline</Text>
          </View>

          <View style={styles.btnCol}>
            <TouchableOpacity style={[styles.circleBtn, styles.acceptBtn]} onPress={handleAccept}>
              <Ionicons
                name={incomingCall.callType === CallType.VIDEO ? 'videocam' : 'call'}
                size={30}
                color="#FFFFFF"
              />
            </TouchableOpacity>
            <Text style={styles.btnText}>Accept</Text>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B141A',
    justifyContent: 'space-between',
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  top: { alignItems: 'center', gap: 16, marginTop: 32 },
  callLabel: { color: '#00A884', fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },
  callerName: { color: '#FFFFFF', fontSize: 28, fontWeight: '700', marginTop: 8 },
  encrypted: { color: '#8696A0', fontSize: 13 },
  actionsRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  btnCol: { alignItems: 'center', gap: 10 },
  circleBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineBtn: { backgroundColor: '#EA0038' },
  acceptBtn: { backgroundColor: '#25D366' },
  btnText: { color: '#E5E7EB', fontSize: 15, fontWeight: '600' },
});

import React, { useEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Call, CallStatus, CallType } from '@whatsapp-pro/shared-types';
import { useCallStore } from '../../stores/callStore';
import { useAuthStore } from '../../stores/authStore';
import { useTheme } from '../../theme/colors';
import { extractErrorMessage, RootStackParamList } from '../../types/mobile.types';
import { Avatar } from '../../components/Avatar';

export function CallsScreen() {
  const theme = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const { callHistory, isLoadingHistory, fetchCallHistory, initiateCall } = useCallStore();

  useEffect(() => {
    fetchCallHistory().catch(() => {});
  }, [fetchCallHistory]);

  const handleRedial = async (call: Call) => {
    if (!call.conversationId) {
      Alert.alert('Unavailable', 'Start a call from the chat screen.');
      return;
    }
    const peer = call.participants?.find((p) => p.userId !== currentUserId)?.user ?? call.caller;
    const peerIds = (call.participants ?? [])
      .map((p) => p.userId)
      .filter((id) => id && id !== currentUserId);
    try {
      const callId = await initiateCall({
        conversationId: call.conversationId,
        callType: call.callType,
        peerName: peer?.displayName || 'Contact',
        peerAvatar: peer?.avatarUrl,
        peerUserIds: peerIds,
      });
      navigation.navigate('ActiveCall', {
        callId,
        conversationId: call.conversationId,
        callType: call.callType,
        peerName: peer?.displayName || 'Contact',
        peerAvatar: peer?.avatarUrl,
        isCaller: true,
      });
    } catch (err) {
      Alert.alert('Call Failed', extractErrorMessage(err));
    }
  };

  const renderCall = ({ item }: { item: Call }) => {
    const isOutgoing = item.callerId === currentUserId;
    const isMissed = item.status === CallStatus.MISSED || item.status === CallStatus.REJECTED;
    const peer = isOutgoing
      ? item.participants?.find((p) => p.userId !== currentUserId)?.user
      : item.caller;
    const peerName = peer?.displayName || 'WhatsApp Pro User';

    const durationText =
      item.durationSeconds && item.durationSeconds > 0
        ? ` • ${Math.floor(item.durationSeconds / 60)}m ${item.durationSeconds % 60}s`
        : '';

    return (
      <TouchableOpacity
        style={[styles.row, { borderBottomColor: theme.divider }]}
        onPress={() => handleRedial(item)}
      >
        <Avatar uri={peer?.avatarUrl} name={peerName} size={48} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: isMissed ? theme.danger : theme.text }]}>
            {peerName}
          </Text>
          <View style={styles.metaRow}>
            <Ionicons
              name={isOutgoing ? 'arrow-up' : 'arrow-down'}
              size={14}
              color={isMissed ? theme.danger : theme.primary}
            />
            <Text style={{ color: theme.textSecondary, fontSize: 13 }}>
              {new Date(item.createdAt).toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
              {durationText}
            </Text>
          </View>
        </View>
        <TouchableOpacity onPress={() => handleRedial(item)} style={{ padding: 8 }}>
          <Ionicons
            name={item.callType === CallType.VIDEO ? 'videocam' : 'call'}
            size={22}
            color={theme.primary}
          />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <FlatList
        data={callHistory}
        keyExtractor={(item) => item.id}
        renderItem={renderCall}
        refreshControl={
          <RefreshControl refreshing={isLoadingHistory} onRefresh={fetchCallHistory} tintColor={theme.primary} />
        }
        ListEmptyComponent={
          isLoadingHistory ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={theme.primary} />
            </View>
          ) : (
            <View style={styles.center}>
              <Ionicons name="call-outline" size={50} color={theme.textMuted} />
              <Text style={[styles.emptyTitle, { color: theme.text }]}>No recent calls</Text>
              <Text style={{ color: theme.textSecondary, textAlign: 'center' }}>
                Start an encrypted audio or video call from any conversation.
              </Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  name: { fontSize: 16, fontWeight: '700', marginBottom: 3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  center: { padding: 48, alignItems: 'center', gap: 10 },
  emptyTitle: { fontSize: 17, fontWeight: '700' },
});

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../../services/api';
import notificationsService from '../../services/notifications';
import { useChatStore } from '../../stores/chatStore';
import { useTheme } from '../../theme/colors';
import { extractErrorMessage, unwrapApiData } from '../../types/mobile.types';

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

export function NotificationSettingsScreen() {
  const theme = useTheme();
  const { conversations, muteConversation } = useChatStore();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/notifications', { params: { limit: 25 } });
      const raw = unwrapApiData<{ items?: NotificationItem[] } | NotificationItem[]>(res.data);
      const list = Array.isArray(raw) ? raw : raw?.items ?? [];
      setNotifications(list);
    } catch {
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const handleMarkAllRead = async () => {
    try {
      await api.patch('/notifications/read-all');
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch (err) {
      Alert.alert('Error', extractErrorMessage(err));
    }
  };

  const handleSyncPush = async () => {
    const token = await notificationsService.registerAndSyncPushToken();
    Alert.alert(
      token ? 'Push Enabled' : 'Push Registration',
      token ? 'Device push token synced with WhatsApp Pro.' : 'Notifications require a physical device.',
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View>
            <TouchableOpacity
              style={[styles.pushBtn, { backgroundColor: theme.surface, borderColor: theme.border }]}
              onPress={handleSyncPush}
            >
              <Ionicons name="notifications" size={20} color={theme.primary} />
              <Text style={{ color: theme.text, fontWeight: '600', flex: 1 }}>
                Re-sync Push Notification Token
              </Text>
              <Ionicons name="refresh" size={18} color={theme.primary} />
            </TouchableOpacity>

            <Text style={[styles.sectionTitle, { color: theme.primary }]}>
              CHAT MUTE SETTINGS
            </Text>
            {conversations.slice(0, 10).map((c) => (
              <View key={c.id} style={[styles.row, { borderBottomColor: theme.divider }]}>
                <Text numberOfLines={1} style={[styles.rowTitle, { color: theme.text, flex: 1 }]}>
                  {c.title}
                </Text>
                <Switch
                  value={!c.isMuted}
                  onValueChange={(enabled) => muteConversation(c.id, !enabled).catch(() => {})}
                  trackColor={{ true: theme.primary, false: theme.border }}
                />
              </View>
            ))}

            <View style={styles.recentHeader}>
              <Text style={[styles.sectionTitle, { color: theme.primary, paddingTop: 0, paddingBottom: 0 }]}>
                RECENT ALERTS
              </Text>
              {notifications.length > 0 && (
                <TouchableOpacity onPress={handleMarkAllRead}>
                  <Text style={{ color: theme.primary, fontWeight: '600', fontSize: 13 }}>
                    Mark all read
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.notifRow, { borderBottomColor: theme.divider }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: theme.text }]}>{item.title}</Text>
              <Text style={{ color: theme.textSecondary, fontSize: 13 }}>{item.body}</Text>
            </View>
            {!item.isRead && <View style={[styles.dot, { backgroundColor: theme.primary }]} />}
          </View>
        )}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={{ margin: 24 }} color={theme.primary} />
          ) : (
            <Text style={{ color: theme.textMuted, padding: 24, textAlign: 'center' }}>
              No recent notifications.
            </Text>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  pushBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 16,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  sectionTitle: { fontSize: 12, fontWeight: '700', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  recentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingRight: 16,
    paddingTop: 18,
    paddingBottom: 6,
  },
  notifRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});

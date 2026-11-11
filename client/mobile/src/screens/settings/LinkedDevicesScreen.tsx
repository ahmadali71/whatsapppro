import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { UserDevice } from '@whatsapp-pro/shared-types';
import api from '../../services/api';
import { useTheme } from '../../theme/colors';
import { extractErrorMessage, unwrapApiData } from '../../types/mobile.types';

interface SessionItem {
  id: string;
  deviceId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
}

export function LinkedDevicesScreen() {
  const theme = useTheme();
  const [devices, setDevices] = useState<UserDevice[]>([]);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [devRes, sessRes] = await Promise.all([
        api.get('/users/devices').catch(() => null),
        api.get('/privacy/sessions').catch(() => null),
      ]);
      if (devRes) {
        const dList = unwrapApiData<UserDevice[]>(devRes.data) ?? [];
        setDevices(Array.isArray(dList) ? dList : []);
      }
      if (sessRes) {
        const sList = unwrapApiData<Record<string, any>[]>(sessRes.data) ?? [];
        setSessions(
          sList.map((s) => ({
            id: String(s.id),
            deviceId: s.deviceId ?? s.device_id ?? null,
            ipAddress: s.ipAddress ?? s.ip_address ?? null,
            userAgent: s.userAgent ?? s.user_agent ?? null,
            createdAt: s.createdAt ?? s.created_at ?? new Date().toISOString(),
          })),
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const removeDevice = async (deviceId: string) => {
    try {
      await api.delete(`/users/devices/${deviceId}`);
      setDevices((prev) => prev.filter((d) => d.deviceId !== deviceId && d.id !== deviceId));
    } catch (err) {
      Alert.alert('Error', extractErrorMessage(err));
    }
  };

  const revokeSession = async (sessionId: string) => {
    try {
      await api.delete(`/privacy/sessions/${sessionId}`);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err) {
      Alert.alert('Error', extractErrorMessage(err));
    }
  };

  const revokeAllOther = () => {
    Alert.alert('Log out other sessions', 'Revoke all other active sessions?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke All',
        style: 'destructive',
        onPress: async () => {
          await api.delete('/privacy/sessions');
          await loadData();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={loadData} tintColor={theme.primary} />
        }
      >
        <Text style={[styles.sectionTitle, { color: theme.primary }]}>
          LINKED DEVICES ({devices.length})
        </Text>
        {loading && devices.length === 0 ? (
          <ActivityIndicator style={{ margin: 20 }} color={theme.primary} />
        ) : devices.length === 0 ? (
          <Text style={{ color: theme.textMuted, paddingHorizontal: 16 }}>No linked devices.</Text>
        ) : (
          devices.map((d) => (
            <View key={d.id} style={[styles.row, { borderBottomColor: theme.divider }]}>
              <Ionicons
                name={d.platform === 'WEB' ? 'desktop-outline' : 'phone-portrait-outline'}
                size={24}
                color={theme.primary}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: theme.text }]}>{d.deviceName}</Text>
                <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
                  {d.platform} • Last active {new Date(d.lastActiveAt).toLocaleDateString()}
                </Text>
              </View>
              <TouchableOpacity onPress={() => removeDevice(d.deviceId || d.id)}>
                <Text style={{ color: theme.danger, fontWeight: '700' }}>Remove</Text>
              </TouchableOpacity>
            </View>
          ))
        )}

        <View style={styles.sessionHeader}>
          <Text style={[styles.sectionTitle, { color: theme.primary, paddingTop: 0, paddingBottom: 0 }]}>
            ACTIVE SESSIONS ({sessions.length})
          </Text>
          {sessions.length > 1 && (
            <TouchableOpacity onPress={revokeAllOther}>
              <Text style={{ color: theme.danger, fontWeight: '600', fontSize: 13 }}>Revoke Others</Text>
            </TouchableOpacity>
          )}
        </View>

        {sessions.map((s) => (
          <View key={s.id} style={[styles.row, { borderBottomColor: theme.divider }]}>
            <Ionicons name="key-outline" size={22} color={theme.textSecondary} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={[styles.title, { color: theme.text }]}>
                {s.userAgent || s.deviceId || 'Authenticated Session'}
              </Text>
              <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
                {s.ipAddress || 'IP unknown'} • {new Date(s.createdAt).toLocaleDateString()}
              </Text>
            </View>
            <TouchableOpacity onPress={() => revokeSession(s.id)}>
              <Text style={{ color: theme.danger, fontWeight: '700' }}>Revoke</Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  sectionTitle: { fontSize: 12, fontWeight: '700', paddingHorizontal: 16, paddingTop: 18, paddingBottom: 8 },
  sessionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingRight: 16,
    paddingTop: 22,
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
});

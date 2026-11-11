import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { ThemePreference } from '@whatsapp-pro/shared-types';
import api, { getApiBaseUrl, setApiBaseUrl } from '../../services/api';
import socketService from '../../services/socket';
import { useAuthStore } from '../../stores/authStore';
import { useChatStore } from '../../stores/chatStore';
import { useThemeStore } from '../../stores/themeStore';
import { useTheme } from '../../theme/colors';
import { extractErrorMessage, RootStackParamList } from '../../types/mobile.types';
import { Avatar } from '../../components/Avatar';

export function SettingsScreen() {
  const theme = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { user, biometricEnabled, setBiometricEnabled, refreshMe, logout } = useAuthStore();
  const fetchConversations = useChatStore((s) => s.fetchConversations);
  const { themePreference, setThemePreference } = useThemeStore();
  const [serverUrl, setServerUrl] = useState(getApiBaseUrl());
  const [socketConnected, setSocketConnected] = useState(socketService.isConnected());
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    setSocketConnected(socketService.isConnected());
    const unsubConn = socketService.on('socket:connected', () => setSocketConnected(true));
    const unsubDisc = socketService.on('socket:disconnected', () => setSocketConnected(false));
    return () => {
      unsubConn();
      unsubDisc();
    };
  }, []);

  const handleSaveServerUrl = async () => {
    const trimmed = serverUrl.trim();
    if (!trimmed) {
      Alert.alert('Invalid URL', 'Enter your backend URL, e.g. http://192.168.1.50:3001 or https://your-domain.com');
      return;
    }
    setReconnecting(true);
    try {
      const normalized = await setApiBaseUrl(trimmed);
      setServerUrl(normalized);
      await api.get('/users/me', { timeout: 6000 });
      await socketService.reconnect();
      await Promise.all([refreshMe().catch(() => {}), fetchConversations(true, true).catch(() => {})]);
      setSocketConnected(socketService.isConnected());
      Alert.alert(
        'Connected',
        `Reachable at ${normalized}. Messages and calls now sync through this server.`,
      );
    } catch (err) {
      setSocketConnected(false);
      Alert.alert(
        'Cannot Reach Server',
        `${extractErrorMessage(err)}\n\nOver Wi-Fi use http://192.168.x.x:3001 (with firewall open on port 3001). Over cellular/internet both phones must use the same public https:// server URL.`,
      );
    } finally {
      setReconnecting(false);
    }
  };

  const toggleBiometric = async (val: boolean) => {
    const ok = await setBiometricEnabled(val);
    if (!ok && val) {
      Alert.alert(
        'Unavailable',
        'Biometric authentication is not set up on this device.',
      );
    }
  };

  const handleLogout = () => {
    Alert.alert('Log out', 'Are you sure you want to log out of WhatsApp Pro?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => logout() },
    ]);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView>
        {/* Profile Header */}
        <TouchableOpacity
          style={[styles.profileCard, { borderBottomColor: theme.divider }]}
          onPress={() => navigation.navigate('ProfileSetup', { isOnboarding: false })}
        >
          <Avatar uri={user?.avatarUrl} name={user?.displayName} size={64} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.displayName, { color: theme.text }]}>
              {user?.displayName || 'User'}
            </Text>
            <Text numberOfLines={1} style={{ color: theme.textSecondary, fontSize: 14 }}>
              {user?.about || 'Hey there! I am using WhatsApp Pro.'}
            </Text>
            {user?.username ? (
              <Text style={{ color: theme.primary, fontSize: 12, marginTop: 2 }}>
                @{user.username}
              </Text>
            ) : null}
          </View>
          <Ionicons name="create-outline" size={22} color={theme.primary} />
        </TouchableOpacity>

        {/* Quick Security & Theme Toggles */}
        <View style={[styles.section, { borderBottomColor: theme.divider }]}>
          <View style={styles.toggleRow}>
            <Ionicons name="finger-print" size={22} color={theme.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: theme.text }]}>Biometric App Lock</Text>
              <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
                Require Face ID or Fingerprint when opening app
              </Text>
            </View>
            <Switch
              value={biometricEnabled}
              onValueChange={toggleBiometric}
              trackColor={{ true: theme.primary, false: theme.border }}
            />
          </View>

          <View style={styles.toggleRow}>
            <Ionicons name={theme.isDark ? 'moon' : 'sunny'} size={22} color={theme.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: theme.text }]}>Dark Mode</Text>
              <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
                Theme: {themePreference}
              </Text>
            </View>
            <Switch
              value={theme.isDark}
              onValueChange={(val) =>
                setThemePreference(val ? ThemePreference.DARK : ThemePreference.LIGHT)
              }
              trackColor={{ true: theme.primary, false: theme.border }}
            />
          </View>
        </View>

        {/* Server & Internet Connection */}
        <View style={[styles.serverCard, { borderBottomColor: theme.divider }]}>
          <View style={styles.serverHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="globe-outline" size={20} color={theme.primary} />
              <Text style={[styles.rowTitle, { color: theme.text }]}>Server & Internet Sync</Text>
            </View>
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: socketConnected ? '#DCFCE7' : '#FEE2E2' },
              ]}
            >
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: socketConnected ? '#16A34A' : '#DC2626' },
                ]}
              />
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: '700',
                  color: socketConnected ? '#166534' : '#991B1B',
                }}
              >
                {socketConnected ? 'Realtime Online' : 'Offline'}
              </Text>
            </View>
          </View>
          <Text style={{ color: theme.textSecondary, fontSize: 12, marginTop: 4 }}>
            Use http://&lt;PC-LAN-IP&gt;:3001 on Wi-Fi or your public https:// server URL to message and call across the internet.
          </Text>
          <View style={styles.serverInputRow}>
            <TextInput
              value={serverUrl}
              onChangeText={setServerUrl}
              placeholder="https://your-server.com/api/v1"
              placeholderTextColor={theme.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={[
                styles.serverInput,
                {
                  backgroundColor: theme.surface,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
            />
            <TouchableOpacity
              onPress={handleSaveServerUrl}
              disabled={reconnecting}
              style={[styles.reconnectBtn, { backgroundColor: theme.primary }]}
            >
              {reconnecting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 13 }}>Connect</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Navigation Sub-screens */}
        <SettingsItem
          icon="key-outline"
          title="Account"
          subtitle="Two-step verification, change number, delete account"
          onPress={() => navigation.navigate('AccountSettings')}
        />
        <SettingsItem
          icon="lock-closed-outline"
          title="Privacy"
          subtitle="Block contacts, disappearing messages, last seen"
          onPress={() => navigation.navigate('PrivacySettings')}
        />
        <SettingsItem
          icon="chatbubble-outline"
          title="Chats"
          subtitle="Theme, wallpapers, font size, chat backup"
          onPress={() => navigation.navigate('ChatSettings')}
        />
        <SettingsItem
          icon="notifications-outline"
          title="Notifications"
          subtitle="Conversation mutes, alerts & message tones"
          onPress={() => navigation.navigate('NotificationSettings')}
        />
        <SettingsItem
          icon="server-outline"
          title="Storage and data"
          subtitle="Network usage, auto-download, clear chat storage"
          onPress={() => navigation.navigate('StorageSettings')}
        />
        <SettingsItem
          icon="laptop-outline"
          title="Linked devices"
          subtitle="Manage active devices and login sessions"
          onPress={() => navigation.navigate('LinkedDevices')}
        />

        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={22} color={theme.danger} />
          <Text style={{ color: theme.danger, fontSize: 16, fontWeight: '700' }}>Log out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function SettingsItem({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <TouchableOpacity
      style={[styles.navRow, { borderBottomColor: theme.divider }]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={22} color={theme.textSecondary} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: theme.text }]}>{title}</Text>
        <Text style={{ color: theme.textSecondary, fontSize: 13 }}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  displayName: { fontSize: 18, fontWeight: '700', marginBottom: 2 },
  section: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 16,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 15,
    gap: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowTitle: { fontSize: 16, fontWeight: '600', marginBottom: 2 },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 20,
    marginTop: 8,
    marginBottom: 24,
  },
  serverCard: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  serverHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  serverInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  serverInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
  reconnectBtn: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

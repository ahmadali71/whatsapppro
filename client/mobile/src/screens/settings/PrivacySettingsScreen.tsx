import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { PrivacyVisibility, User } from '@whatsapp-pro/shared-types';
import api from '../../services/api';
import { useTheme } from '../../theme/colors';
import { extractErrorMessage, normalizeUser, unwrapApiData } from '../../types/mobile.types';
import { Avatar } from '../../components/Avatar';

const VISIBILITY_OPTIONS: PrivacyVisibility[] = [
  PrivacyVisibility.ALL,
  PrivacyVisibility.CONTACTS,
  PrivacyVisibility.NOBODY,
];

export function PrivacySettingsScreen() {
  const theme = useTheme();
  const [loading, setLoading] = useState(true);
  const [lastSeen, setLastSeen] = useState<PrivacyVisibility>(PrivacyVisibility.ALL);
  const [online, setOnline] = useState<PrivacyVisibility>(PrivacyVisibility.ALL);
  const [profilePhoto, setProfilePhoto] = useState<PrivacyVisibility>(PrivacyVisibility.ALL);
  const [about, setAbout] = useState<PrivacyVisibility>(PrivacyVisibility.ALL);
  const [statusVis, setStatusVis] = useState<PrivacyVisibility>(PrivacyVisibility.CONTACTS);
  const [readReceipts, setReadReceipts] = useState(true);
  const [blockedUsers, setBlockedUsers] = useState<User[]>([]);

  const loadPrivacy = useCallback(async () => {
    setLoading(true);
    try {
      const [privRes, blockRes] = await Promise.all([
        api.get('/privacy/settings'),
        api.get('/users/blocked').catch(() => null),
      ]);
      const p = unwrapApiData<Record<string, any>>(privRes.data) ?? {};
      setLastSeen(p.lastSeenVisibility ?? p.last_seen_visibility ?? PrivacyVisibility.ALL);
      setOnline(p.onlineVisibility ?? p.online_visibility ?? PrivacyVisibility.ALL);
      setProfilePhoto(p.profilePhotoVisibility ?? p.profile_photo_visibility ?? PrivacyVisibility.ALL);
      setAbout(p.aboutVisibility ?? p.about_visibility ?? PrivacyVisibility.ALL);
      setStatusVis(p.statusVisibility ?? p.status_visibility ?? PrivacyVisibility.CONTACTS);
      setReadReceipts(Boolean(p.readReceiptsEnabled ?? p.read_receipts_enabled ?? true));

      if (blockRes) {
        const bList = unwrapApiData<Record<string, any>[]>(blockRes.data) ?? [];
        setBlockedUsers(
          bList.map((entry) => normalizeUser(entry.blockedUser ?? entry.blocked ?? entry)),
        );
      }
    } catch {
      // keep defaults
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPrivacy();
  }, [loadPrivacy]);

  const patchPrivacy = async (patch: Record<string, unknown>) => {
    try {
      await api.patch('/privacy/settings', patch);
    } catch (err) {
      Alert.alert('Update Failed', extractErrorMessage(err));
    }
  };

  const pickVisibility = (
    title: string,
    fieldCamel: string,
    setter: (v: PrivacyVisibility) => void,
  ) => {
    Alert.alert(title, 'Who can see this?', [
      ...VISIBILITY_OPTIONS.map((opt) => ({
        text: opt === 'ALL' ? 'Everyone' : opt === 'CONTACTS' ? 'My Contacts' : 'Nobody',
        onPress: () => {
          setter(opt);
          patchPrivacy({ [fieldCamel]: opt });
        },
      })),
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleUnblock = async (target: User) => {
    try {
      await api.delete(`/users/block/${target.id}`);
      setBlockedUsers((prev) => prev.filter((u) => u.id !== target.id));
    } catch (err) {
      Alert.alert('Error', extractErrorMessage(err));
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView>
        <Text style={[styles.sectionTitle, { color: theme.primary }]}>Who can see my personal info</Text>

        <VisibilityRow
          label="Last seen"
          value={lastSeen}
          onPress={() => pickVisibility('Last seen', 'lastSeenVisibility', setLastSeen)}
        />
        <VisibilityRow
          label="Online status"
          value={online}
          onPress={() => pickVisibility('Online status', 'onlineVisibility', setOnline)}
        />
        <VisibilityRow
          label="Profile photo"
          value={profilePhoto}
          onPress={() =>
            pickVisibility('Profile photo', 'profilePhotoVisibility', setProfilePhoto)
          }
        />
        <VisibilityRow
          label="About"
          value={about}
          onPress={() => pickVisibility('About', 'aboutVisibility', setAbout)}
        />
        <VisibilityRow
          label="Status updates"
          value={statusVis}
          onPress={() => pickVisibility('Status', 'statusVisibility', setStatusVis)}
        />

        <View style={[styles.switchRow, { borderBottomColor: theme.divider }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.label, { color: theme.text }]}>Read receipts</Text>
            <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
              If turned off, you won't send or receive read receipts.
            </Text>
          </View>
          <Switch
            value={readReceipts}
            onValueChange={(val) => {
              setReadReceipts(val);
              patchPrivacy({ readReceiptsEnabled: val });
            }}
            trackColor={{ true: theme.primary, false: theme.border }}
          />
        </View>

        <Text style={[styles.sectionTitle, { color: theme.primary, marginTop: 18 }]}>
          Blocked contacts ({blockedUsers.length})
        </Text>
        {blockedUsers.length === 0 ? (
          <Text style={{ color: theme.textMuted, paddingHorizontal: 16, paddingBottom: 24 }}>
            No blocked contacts.
          </Text>
        ) : (
          blockedUsers.map((u) => (
            <View key={u.id} style={[styles.blockedRow, { borderBottomColor: theme.divider }]}>
              <Avatar uri={u.avatarUrl} name={u.displayName} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontWeight: '600' }}>{u.displayName}</Text>
                <Text style={{ color: theme.textSecondary, fontSize: 12 }}>{u.phoneNumber}</Text>
              </View>
              <TouchableOpacity onPress={() => handleUnblock(u)}>
                <Text style={{ color: theme.primary, fontWeight: '700' }}>Unblock</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function VisibilityRow({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: theme.divider }]}
      onPress={onPress}
    >
      <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
      <Text style={{ color: theme.textSecondary, fontSize: 14 }}>{value}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 13, fontWeight: '700', paddingHorizontal: 16, paddingTop: 18, paddingBottom: 8 },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: { fontSize: 16, fontWeight: '600' },
  blockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});

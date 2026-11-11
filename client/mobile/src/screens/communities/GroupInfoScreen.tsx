import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { Group, GroupMember, MemberRole } from '@whatsapp-pro/shared-types';
import api, { resolveMediaUrl } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { useTheme } from '../../theme/colors';
import {
  extractErrorMessage,
  normalizeUser,
  RootStackParamList,
  unwrapApiData,
} from '../../types/mobile.types';
import { Avatar } from '../../components/Avatar';

type Props = NativeStackScreenProps<RootStackParamList, 'GroupInfo'>;

export function GroupInfoScreen({ route, navigation }: Props) {
  const { groupId, conversationId } = route.params;
  const theme = useTheme();
  const currentUserId = useAuthStore((s) => s.user?.id ?? '');

  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [media, setMedia] = useState<Array<{ id: string; fileUrl: string }>>([]);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [addPhoneQuery, setAddPhoneQuery] = useState('');

  const loadGroup = useCallback(async () => {
    setLoading(true);
    try {
      const [gRes, mRes, mediaRes] = await Promise.all([
        api.get(`/groups/${groupId}`),
        api.get(`/groups/${groupId}/members`),
        api.get(`/groups/${groupId}/media`).catch(() => null),
      ]);
      const gData = unwrapApiData<Group>(gRes.data);
      const mData = unwrapApiData<Record<string, any>[]>(mRes.data) ?? [];
      setGroup(gData);
      setDraftName(gData?.name ?? '');
      setInviteLink(gData?.inviteLink ?? null);
      setMembers(
        mData.map((m) => ({
          id: String(m.id ?? ''),
          groupId: String(m.groupId ?? m.group_id ?? groupId),
          userId: String(m.userId ?? m.user_id ?? m.user?.id ?? ''),
          role: (m.role ?? MemberRole.MEMBER) as MemberRole,
          joinedAt: m.joinedAt ?? m.joined_at ?? new Date().toISOString(),
          isActive: Boolean(m.isActive ?? m.is_active ?? true),
          user: m.user || m.users ? normalizeUser(m.user ?? m.users) : undefined,
        })),
      );
      if (mediaRes) {
        const med = unwrapApiData<Array<{ id: string; fileUrl?: string; file_url?: string }>>(mediaRes.data) ?? [];
        setMedia(med.map((x) => ({ id: x.id, fileUrl: x.fileUrl ?? x.file_url ?? '' })).filter((x) => x.fileUrl));
      }
    } catch (err) {
      Alert.alert('Error', extractErrorMessage(err, 'Could not load group info'));
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    loadGroup();
  }, [loadGroup]);

  const myRole = members.find((m) => m.userId === currentUserId)?.role;
  const isAdmin = myRole === MemberRole.ADMIN || myRole === MemberRole.OWNER;

  const handleSaveName = async () => {
    if (!draftName.trim()) return;
    try {
      await api.patch(`/groups/${groupId}`, { name: draftName.trim() });
      setEditingName(false);
      await loadGroup();
    } catch (err) {
      Alert.alert('Update Failed', extractErrorMessage(err));
    }
  };

  const handleGenerateInvite = async () => {
    try {
      const res = await api.post(`/groups/${groupId}/invite-link`);
      const data = unwrapApiData<{ inviteCode?: string; inviteLink?: string }>(res.data);
      const link = data?.inviteLink || data?.inviteCode || '';
      setInviteLink(link);
      if (link) {
        await Clipboard.setStringAsync(link);
        Alert.alert('Invite Link Copied', link);
      }
    } catch (err) {
      Alert.alert('Error', extractErrorMessage(err));
    }
  };

  const handleRevokeInvite = async () => {
    try {
      await api.delete(`/groups/${groupId}/invite-link`);
      setInviteLink(null);
      Alert.alert('Revoked', 'Previous invite link has been disabled.');
    } catch (err) {
      Alert.alert('Error', extractErrorMessage(err));
    }
  };

  const handleAddMemberByQuery = async () => {
    if (!addPhoneQuery.trim()) return;
    try {
      const searchRes = await api.get('/users/search', {
        params: { q: addPhoneQuery.trim(), type: addPhoneQuery.includes('+') ? 'phone' : 'username' },
      });
      const users = unwrapApiData<Record<string, any>[]>(searchRes.data) ?? [];
      if (users.length === 0) {
        Alert.alert('Not Found', 'No matching user found.');
        return;
      }
      await api.post(`/groups/${groupId}/members`, { userIds: [users[0].id] });
      setAddPhoneQuery('');
      await loadGroup();
    } catch (err) {
      Alert.alert('Could Not Add Member', extractErrorMessage(err));
    }
  };

  const handleMemberPress = (member: GroupMember) => {
    if (!isAdmin || member.userId === currentUserId) return;
    const isTargetAdmin = member.role === MemberRole.ADMIN;
    Alert.alert(member.user?.displayName || 'Member', `Role: ${member.role}`, [
      {
        text: isTargetAdmin ? 'Dismiss as Admin' : 'Make Group Admin',
        onPress: async () => {
          try {
            await api.patch(`/groups/${groupId}/members/${member.userId}/role`, {
              role: isTargetAdmin ? MemberRole.MEMBER : MemberRole.ADMIN,
            });
            await loadGroup();
          } catch (err) {
            Alert.alert('Error', extractErrorMessage(err));
          }
        },
      },
      {
        text: 'Remove from Group',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/groups/${groupId}/members/${member.userId}`);
            await loadGroup();
          } catch (err) {
            Alert.alert('Error', extractErrorMessage(err));
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleSetDisappearing = () => {
    const updateTimer = async (timeout: '24h' | '7d' | '90d' | 'off', label: string) => {
      try {
        await api.post(`/privacy/disappearing-messages/${conversationId}`, { timeout });
        Alert.alert('Updated', `Disappearing messages set to ${label}.`);
      } catch (err) {
        Alert.alert('Failed', extractErrorMessage(err));
      }
    };
    Alert.alert('Disappearing Messages', 'Automatically delete new messages after:', [
      { text: '24 Hours', onPress: () => updateTimer('24h', '24 Hours') },
      { text: '7 Days', onPress: () => updateTimer('7d', '7 Days') },
      { text: '90 Days', onPress: () => updateTimer('90d', '90 Days') },
      { text: 'Off', onPress: () => updateTimer('off', 'Off') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleLeaveGroup = () => {
    Alert.alert('Exit Group', 'Are you sure you want to leave this group?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Exit',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/groups/${groupId}/members/${currentUserId}`);
            navigation.popToTop();
          } catch (err) {
            Alert.alert('Error', extractErrorMessage(err));
          }
        },
      },
    ]);
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
        <View style={[styles.hero, { backgroundColor: theme.surface }]}>
          <Avatar uri={group?.avatarUrl} name={group?.name} size={86} isGroup />
          {editingName ? (
            <View style={styles.editRow}>
              <TextInput
                value={draftName}
                onChangeText={setDraftName}
                style={[styles.editInput, { color: theme.text, borderColor: theme.primary }]}
              />
              <TouchableOpacity onPress={handleSaveName}>
                <Ionicons name="checkmark-circle" size={28} color={theme.primary} />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.editRow}>
              <Text style={[styles.groupTitle, { color: theme.text }]}>{group?.name}</Text>
              {isAdmin && (
                <TouchableOpacity onPress={() => setEditingName(true)}>
                  <Ionicons name="pencil" size={18} color={theme.primary} />
                </TouchableOpacity>
              )}
            </View>
          )}
          <Text style={{ color: theme.textSecondary, fontSize: 13 }}>
            Group • {members.length} participants
          </Text>
          {group?.description ? (
            <Text style={{ color: theme.textSecondary, textAlign: 'center', marginTop: 6 }}>
              {group.description}
            </Text>
          ) : null}
        </View>

        {/* Disappearing & Invite Controls */}
        <View style={[styles.section, { borderBottomColor: theme.divider }]}>
          <TouchableOpacity style={styles.settingRow} onPress={handleSetDisappearing}>
            <Ionicons name="timer-outline" size={22} color={theme.primary} />
            <Text style={[styles.settingText, { color: theme.text }]}>Disappearing messages</Text>
          </TouchableOpacity>

          {isAdmin && (
            <>
              <TouchableOpacity style={styles.settingRow} onPress={handleGenerateInvite}>
                <Ionicons name="link-outline" size={22} color={theme.primary} />
                <Text style={[styles.settingText, { color: theme.text }]}>
                  {inviteLink ? 'Copy invite link' : 'Generate invite link'}
                </Text>
              </TouchableOpacity>
              {inviteLink && (
                <View style={styles.inviteActions}>
                  <TouchableOpacity onPress={() => Share.share({ message: inviteLink })}>
                    <Text style={{ color: theme.primary, fontWeight: '600' }}>Share Link</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleRevokeInvite}>
                    <Text style={{ color: theme.danger, fontWeight: '600' }}>Revoke Link</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}
        </View>

        {/* Shared Media Gallery */}
        {media.length > 0 && (
          <View style={[styles.section, { borderBottomColor: theme.divider }]}>
            <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>
              MEDIA ({media.length})
            </Text>
            <FlatList
              horizontal
              data={media}
              keyExtractor={(m) => m.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}
              renderItem={({ item }) => (
                <Image
                  source={{ uri: resolveMediaUrl(item.fileUrl) ?? item.fileUrl }}
                  style={styles.mediaThumb}
                />
              )}
            />
          </View>
        )}

        {/* Members */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>
            {members.length} PARTICIPANTS
          </Text>

          {isAdmin && (
            <View style={styles.addRow}>
              <TextInput
                value={addPhoneQuery}
                onChangeText={setAddPhoneQuery}
                placeholder="Add member by phone or username..."
                placeholderTextColor={theme.textMuted}
                autoCapitalize="none"
                style={[styles.addInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
              />
              <TouchableOpacity
                onPress={handleAddMemberByQuery}
                style={[styles.addBtn, { backgroundColor: theme.primary }]}
              >
                <Ionicons name="person-add" size={18} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          )}

          {members.map((m) => (
            <TouchableOpacity
              key={m.id}
              style={styles.memberRow}
              onPress={() => handleMemberPress(m)}
            >
              <Avatar uri={m.user?.avatarUrl} name={m.user?.displayName} size={42} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600' }}>
                  {m.userId === currentUserId ? 'You' : m.user?.displayName || 'Member'}
                </Text>
                <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
                  {m.user?.about || m.user?.phoneNumber || ''}
                </Text>
              </View>
              {m.role !== MemberRole.MEMBER && (
                <View style={[styles.roleBadge, { borderColor: theme.primary }]}>
                  <Text style={{ color: theme.primary, fontSize: 11, fontWeight: '700' }}>
                    {m.role}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.leaveBtn} onPress={handleLeaveGroup}>
          <Ionicons name="exit-outline" size={22} color={theme.danger} />
          <Text style={{ color: theme.danger, fontSize: 16, fontWeight: '700' }}>Exit group</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hero: { alignItems: 'center', padding: 24, gap: 6 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  editInput: { borderBottomWidth: 1.5, fontSize: 18, fontWeight: '700', minWidth: 180, paddingVertical: 4 },
  groupTitle: { fontSize: 21, fontWeight: '700' },
  section: { padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  sectionTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 6 },
  settingText: { fontSize: 16, fontWeight: '500' },
  inviteActions: { flexDirection: 'row', gap: 20, paddingLeft: 36 },
  mediaThumb: { width: 78, height: 78, borderRadius: 8 },
  addRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  addInput: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  addBtn: { padding: 10, borderRadius: 10 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  roleBadge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  leaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 20,
    marginBottom: 24,
  },
});

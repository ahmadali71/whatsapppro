import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { Community, ConversationType } from '@whatsapp-pro/shared-types';
import api from '../../services/api';
import { useChatStore } from '../../stores/chatStore';
import { useTheme } from '../../theme/colors';
import { extractErrorMessage, RootStackParamList, unwrapApiData } from '../../types/mobile.types';
import { Avatar } from '../../components/Avatar';

const COMMUNITY_IDS_KEY = 'whatsapp_pro_community_ids';

export function CommunitiesScreen() {
  const theme = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { conversations, fetchConversations } = useChatStore();

  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [createCommunityOpen, setCreateCommunityOpen] = useState(false);
  const [joinInviteOpen, setJoinInviteOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const groupConversations = conversations.filter((c) => c.type !== ConversationType.DIRECT);

  const loadCommunities = useCallback(async () => {
    setLoading(true);
    try {
      await fetchConversations();
      const res = await api.get('/communities').catch(() => null);
      if (res) {
        const list = unwrapApiData<Community[]>(res.data) ?? [];
        setCommunities(Array.isArray(list) ? list : []);
      } else {
        const rawIds = await SecureStore.getItemAsync(COMMUNITY_IDS_KEY).catch(() => null);
        const savedIds: string[] = rawIds ? JSON.parse(rawIds) : [];
        if (Array.isArray(savedIds) && savedIds.length > 0) {
          const fetched = await Promise.all(
            savedIds.map((id) =>
              api
                .get(`/communities/${id}`)
                .then((r) => unwrapApiData<Community>(r.data))
                .catch(() => null),
            ),
          );
          setCommunities(fetched.filter((c): c is Community => Boolean(c?.id)));
        }
      }
    } finally {
      setLoading(false);
    }
  }, [fetchConversations]);

  useEffect(() => {
    loadCommunities();
  }, [loadCommunities]);

  const handleCreateCommunity = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const res = await api.post('/communities', {
        name: name.trim(),
        description: description.trim() || undefined,
      });
      const created = unwrapApiData<Community>(res.data);
      if (created?.id) {
        setCommunities((prev) => [created, ...prev.filter((c) => c.id !== created.id)]);
        try {
          const rawIds = await SecureStore.getItemAsync(COMMUNITY_IDS_KEY);
          const ids: string[] = rawIds ? JSON.parse(rawIds) : [];
          const next = Array.from(new Set([created.id, ...(Array.isArray(ids) ? ids : [])])).slice(0, 50);
          await SecureStore.setItemAsync(COMMUNITY_IDS_KEY, JSON.stringify(next));
        } catch {
          // ignore local cache error
        }
      }
      setName('');
      setDescription('');
      setCreateCommunityOpen(false);
      await fetchConversations();
    } catch (err) {
      Alert.alert('Error', extractErrorMessage(err, 'Could not create community'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleJoinByInvite = async () => {
    const code = inviteCode.trim().split('/').pop() || '';
    if (!code) return;
    setSubmitting(true);
    try {
      await api.post(`/groups/join/${code}`);
      setInviteCode('');
      setJoinInviteOpen(false);
      await fetchConversations();
      Alert.alert('Joined', 'You have joined the group.');
    } catch (err) {
      Alert.alert('Invalid Link', extractErrorMessage(err, 'Could not join via invite code.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.topActions}>
        <TouchableOpacity
          style={[styles.actionCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
          onPress={() => setCreateCommunityOpen(true)}
        >
          <View style={[styles.iconBox, { backgroundColor: theme.primary }]}>
            <Ionicons name="people" size={22} color="#FFFFFF" />
          </View>
          <Text style={[styles.actionLabel, { color: theme.text }]}>New community</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
          onPress={() => setJoinInviteOpen(true)}
        >
          <View style={[styles.iconBox, { backgroundColor: '#0EA5E9' }]}>
            <Ionicons name="link" size={22} color="#FFFFFF" />
          </View>
          <Text style={[styles.actionLabel, { color: theme.text }]}>Join via invite</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={[
          ...communities.map((c) => ({ kind: 'COMMUNITY' as const, id: c.id, title: c.name, subtitle: c.description || 'Community', avatarUrl: c.avatarUrl })),
          ...groupConversations.map((g) => ({
            kind: 'GROUP' as const,
            id: g.id,
            groupId: g.groupId,
            title: g.title || 'Group',
            subtitle: `${g.members?.length ?? 0} members`,
            avatarUrl: g.avatarUrl,
          })),
        ]}
        keyExtractor={(item) => `${item.kind}-${item.id}`}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={loadCommunities} tintColor={theme.primary} />
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.row, { borderBottomColor: theme.divider }]}
            onPress={() => {
              if (item.kind === 'GROUP') {
                navigation.navigate('ChatRoom', {
                  conversationId: item.id,
                  title: item.title,
                  avatarUrl: item.avatarUrl,
                });
              } else {
                Alert.alert(item.title, item.subtitle || 'Community');
              }
            }}
            onLongPress={() => {
              if (item.kind === 'GROUP' && item.groupId) {
                navigation.navigate('GroupInfo', {
                  groupId: item.groupId,
                  conversationId: item.id,
                });
              }
            }}
          >
            <Avatar uri={item.avatarUrl} name={item.title} size={48} isGroup />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: theme.text }]}>{item.title}</Text>
              <Text numberOfLines={1} style={{ color: theme.textSecondary, fontSize: 13 }}>
                {item.kind === 'COMMUNITY' ? 'Community • ' : 'Group • '}
                {item.subtitle}
              </Text>
            </View>
            {item.kind === 'GROUP' && item.groupId && (
              <TouchableOpacity
                onPress={() =>
                  navigation.navigate('GroupInfo', {
                    groupId: item.groupId!,
                    conversationId: item.id,
                  })
                }
              >
                <Ionicons name="settings-outline" size={20} color={theme.textMuted} />
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Ionicons name="people-circle-outline" size={56} color={theme.textMuted} />
              <Text style={[styles.emptyTitle, { color: theme.text }]}>Stay connected with a community</Text>
              <Text style={{ color: theme.textSecondary, textAlign: 'center' }}>
                Create a community or join a group using an invite link.
              </Text>
            </View>
          ) : null
        }
      />

      {/* Create Community Modal */}
      <Modal visible={createCommunityOpen} transparent animationType="slide" onRequestClose={() => setCreateCommunityOpen(false)}>
        <View style={[styles.modalBackdrop, { backgroundColor: theme.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: theme.surfaceElevated }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Create Community</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Community name"
              placeholderTextColor={theme.textMuted}
              style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.inputBg }]}
            />
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Description (optional)"
              placeholderTextColor={theme.textMuted}
              multiline
              style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.inputBg, height: 80 }]}
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity onPress={() => setCreateCommunityOpen(false)} style={styles.cancelBtn}>
                <Text style={{ color: theme.textSecondary }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleCreateCommunity}
                disabled={submitting || !name.trim()}
                style={[styles.primaryBtn, { backgroundColor: theme.primary }]}
              >
                {submitting ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnText}>Create</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Join Invite Modal */}
      <Modal visible={joinInviteOpen} transparent animationType="fade" onRequestClose={() => setJoinInviteOpen(false)}>
        <View style={[styles.modalBackdrop, { backgroundColor: theme.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: theme.surfaceElevated }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Join via Invite Link</Text>
            <TextInput
              value={inviteCode}
              onChangeText={setInviteCode}
              placeholder="Paste invite code or URL..."
              placeholderTextColor={theme.textMuted}
              autoCapitalize="none"
              style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.inputBg }]}
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity onPress={() => setJoinInviteOpen(false)} style={styles.cancelBtn}>
                <Text style={{ color: theme.textSecondary }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleJoinByInvite}
                disabled={submitting || !inviteCode.trim()}
                style={[styles.primaryBtn, { backgroundColor: theme.primary }]}
              >
                {submitting ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnText}>Join</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topActions: { flexDirection: 'row', padding: 12, gap: 10 },
  actionCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
  },
  iconBox: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: 14, fontWeight: '700', flexShrink: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowTitle: { fontSize: 16, fontWeight: '700', marginBottom: 2 },
  empty: { padding: 48, alignItems: 'center', gap: 10 },
  emptyTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  modalBackdrop: { flex: 1, justifyContent: 'center', padding: 22 },
  modalCard: { borderRadius: 16, padding: 20, gap: 12 },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  modalBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 6 },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 10 },
  primaryBtn: { paddingHorizontal: 22, paddingVertical: 10, borderRadius: 10 },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '700' },
});

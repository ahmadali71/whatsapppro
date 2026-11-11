import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
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
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { PrivacyVisibility, Status, StatusContentType } from '@whatsapp-pro/shared-types';
import api, { resolveMediaUrl } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { useChatStore } from '../../stores/chatStore';
import { useTheme } from '../../theme/colors';
import {
  extractErrorMessage,
  normalizeUser,
  RootStackParamList,
  StatusGroup,
  unwrapApiData,
} from '../../types/mobile.types';
import { Avatar } from '../../components/Avatar';

const BG_COLORS = ['#075E54', '#1E40AF', '#7C2D12', '#6D28D9', '#BE185D', '#111827'];

function normalizeStatus(raw: Record<string, any>, fallbackUser?: any): Status {
  const userRaw = raw.user ?? raw.users ?? fallbackUser;
  const rawUrl = raw.contentUrl ?? raw.content_url ?? null;
  const viewsList = raw.views ?? raw.status_views ?? [];
  return {
    id: String(raw.id ?? ''),
    userId: String(raw.userId ?? raw.user_id ?? userRaw?.id ?? ''),
    contentType: (raw.contentType ?? raw.content_type ?? StatusContentType.TEXT) as StatusContentType,
    contentUrl: resolveMediaUrl(rawUrl) ?? rawUrl,
    textContent: raw.textContent ?? raw.text_content ?? null,
    caption: raw.caption ?? null,
    backgroundColor: raw.backgroundColor ?? raw.background_color ?? '#075E54',
    fontStyle: raw.fontStyle ?? raw.font_style ?? 'normal',
    privacy: (raw.privacy ?? PrivacyVisibility.ALL) as PrivacyVisibility,
    expiresAt: raw.expiresAt ?? raw.expires_at ?? new Date().toISOString(),
    createdAt: raw.createdAt ?? raw.created_at ?? new Date().toISOString(),
    user: userRaw ? normalizeUser(userRaw) : undefined,
    views: Array.isArray(viewsList)
      ? viewsList
      : raw.isViewed
        ? [{ id: 'viewed', viewerId: 'me', statusId: String(raw.id ?? ''), viewedAt: new Date().toISOString() }]
        : [],
    reactions: raw.reactions ?? raw.status_reactions ?? (raw.myReaction ? [raw.myReaction] : []),
  };
}

function flattenStatusFeed(rawList: Record<string, any>[]): Status[] {
  const result: Status[] = [];
  for (const entry of rawList) {
    if (Array.isArray(entry.statuses)) {
      const owner = entry.user ?? entry.users;
      for (const item of entry.statuses) {
        result.push(normalizeStatus(item, owner));
      }
    } else if (entry.id) {
      result.push(normalizeStatus(entry));
    }
  }
  return result;
}

export function UpdatesScreen() {
  const theme = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const currentUser = useAuthStore((s) => s.user);
  const { uploadMediaFile } = useChatStore();

  const [myStatuses, setMyStatuses] = useState<Status[]>([]);
  const [feedStatuses, setFeedStatuses] = useState<Status[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Text status modal
  const [textModal, setTextModal] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [bgIndex, setBgIndex] = useState(0);
  const [posting, setPosting] = useState(false);

  // Media status preview modal
  const [mediaDraft, setMediaDraft] = useState<{ uri: string; isVideo: boolean; mime: string } | null>(null);
  const [mediaCaption, setMediaCaption] = useState('');
  const [statusPrivacy, setStatusPrivacy] = useState<PrivacyVisibility>(PrivacyVisibility.ALL);

  const fetchStatuses = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [mineRes, feedRes] = await Promise.all([api.get('/statuses/mine'), api.get('/statuses')]);
      const mineRaw = unwrapApiData<Record<string, any>[]>(mineRes.data) ?? [];
      const feedRaw = unwrapApiData<Record<string, any>[]>(feedRes.data) ?? [];
      setMyStatuses(mineRaw.map((item) => normalizeStatus(item)));
      setFeedStatuses(flattenStatusFeed(Array.isArray(feedRaw) ? feedRaw : []));
    } catch (err) {
      if (!silent) {
        setError(extractErrorMessage(err, 'Failed to load status updates'));
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatuses(false);
    const poll = setInterval(() => {
      fetchStatuses(true).catch(() => {});
    }, 10000);
    return () => clearInterval(poll);
  }, [fetchStatuses]);

  const grouped = useMemo(() => {
    const map = new Map<string, StatusGroup>();
    feedStatuses.forEach((st) => {
      if (st.userId === currentUser?.id) return;
      const existing = map.get(st.userId);
      const viewedByMe =
        Boolean((st as any).isViewed) ||
        (st.views ?? []).some(
          (v: any) => v.viewerId === 'me' || (v.viewerId ?? v.viewer_id) === currentUser?.id,
        );
      if (existing) {
        existing.statuses.push(st);
        if (!viewedByMe) existing.hasUnviewed = true;
        if (new Date(st.createdAt) > new Date(existing.latestAt)) {
          existing.latestAt = String(st.createdAt);
        }
      } else {
        map.set(st.userId, {
          userId: st.userId,
          user: st.user ?? normalizeUser({ id: st.userId, displayName: 'Contact' }),
          statuses: [st],
          hasUnviewed: !viewedByMe,
          latestAt: String(st.createdAt),
        });
      }
    });
    const all = Array.from(map.values());
    return {
      recent: all.filter((g) => g.hasUnviewed),
      viewed: all.filter((g) => !g.hasUnviewed),
    };
  }, [feedStatuses, currentUser?.id]);

  const handleCreateTextStatus = async () => {
    if (!statusText.trim()) return;
    setPosting(true);
    try {
      await api.post('/statuses', {
        contentType: StatusContentType.TEXT,
        textContent: statusText.trim(),
        backgroundColor: BG_COLORS[bgIndex],
        privacy: statusPrivacy,
      });
      setStatusText('');
      setTextModal(false);
      await fetchStatuses();
    } catch (err) {
      Alert.alert('Error', extractErrorMessage(err));
    } finally {
      setPosting(false);
    }
  };

  const pickMediaStatus = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 0.85,
    });
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    setMediaDraft({
      uri: asset.uri,
      isVideo: asset.type === 'video',
      mime: asset.mimeType || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg'),
    });
  };

  const handlePostMediaStatus = async () => {
    if (!mediaDraft) return;
    setPosting(true);
    try {
      const uploaded = await uploadMediaFile({
        uri: mediaDraft.uri,
        name: `status-${Date.now()}.${mediaDraft.isVideo ? 'mp4' : 'jpg'}`,
        type: mediaDraft.mime,
      });
      await api.post('/statuses', {
        contentType: mediaDraft.isVideo ? StatusContentType.VIDEO : StatusContentType.IMAGE,
        contentUrl: uploaded.url,
        caption: mediaCaption.trim() || undefined,
        privacy: statusPrivacy,
      });
      setMediaDraft(null);
      setMediaCaption('');
      await fetchStatuses();
    } catch (err) {
      Alert.alert('Upload Failed', extractErrorMessage(err));
    } finally {
      setPosting(false);
    }
  };

  const sections: Array<{ type: 'HEADER' | 'ITEM'; title?: string; group?: StatusGroup }> = [
    ...grouped.recent.length > 0
      ? [{ type: 'HEADER' as const, title: 'Recent updates' }, ...grouped.recent.map((g) => ({ type: 'ITEM' as const, group: g }))]
      : [],
    ...grouped.viewed.length > 0
      ? [{ type: 'HEADER' as const, title: 'Viewed updates' }, ...grouped.viewed.map((g) => ({ type: 'ITEM' as const, group: g }))]
      : [],
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <FlatList
        data={sections}
        keyExtractor={(item, idx) => item.group?.userId ?? `${item.title}-${idx}`}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={() => fetchStatuses(false)} tintColor={theme.primary} />
        }
        ListHeaderComponent={
          <View>
            <TouchableOpacity
              style={[styles.myStatusRow, { borderBottomColor: theme.divider }]}
              onPress={() => {
                if (myStatuses.length > 0 && currentUser) {
                  navigation.navigate('StatusViewer', { userId: currentUser.id });
                } else {
                  pickMediaStatus();
                }
              }}
            >
              <View style={styles.avatarRingWrap}>
                <Avatar uri={currentUser?.avatarUrl} name={currentUser?.displayName} size={54} />
                {myStatuses.length === 0 && (
                  <View style={[styles.addBadge, { backgroundColor: theme.primary, borderColor: theme.background }]}>
                    <Ionicons name="add" size={14} color="#FFFFFF" />
                  </View>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, { color: theme.text }]}>My status</Text>
                <Text style={{ color: theme.textSecondary, fontSize: 13 }}>
                  {myStatuses.length > 0
                    ? `${myStatuses.length} update${myStatuses.length > 1 ? 's' : ''} • Tap to view`
                    : 'Tap to add status update'}
                </Text>
              </View>
              {myStatuses.length > 0 && (
                <TouchableOpacity onPress={pickMediaStatus} style={{ padding: 8 }}>
                  <Ionicons name="camera-outline" size={22} color={theme.primary} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => {
          if (item.type === 'HEADER') {
            return (
              <Text style={[styles.sectionHeader, { color: theme.textSecondary }]}>
                {item.title}
              </Text>
            );
          }
          const group = item.group!;
          return (
            <TouchableOpacity
              style={[styles.statusRow, { borderBottomColor: theme.divider }]}
              onPress={() => navigation.navigate('StatusViewer', { userId: group.userId })}
            >
              <View
                style={[
                  styles.ring,
                  { borderColor: group.hasUnviewed ? theme.primary : theme.textMuted },
                ]}
              >
                <Avatar uri={group.user.avatarUrl} name={group.user.displayName} size={48} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, { color: theme.text }]}>{group.user.displayName}</Text>
                <Text style={{ color: theme.textSecondary, fontSize: 13 }}>
                  {new Date(group.latestAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="radio-button-on-outline" size={44} color={theme.textMuted} />
              <Text style={{ color: theme.textSecondary, textAlign: 'center' }}>
                {error || 'No recent status updates from your contacts.'}
              </Text>
            </View>
          ) : null
        }
      />

      {/* FABs for Text and Camera/Media Status */}
      <View style={styles.fabColumn}>
        <TouchableOpacity
          style={[styles.smallFab, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}
          onPress={() => setTextModal(true)}
        >
          <Ionicons name="pencil" size={20} color={theme.text} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: theme.primary }]}
          onPress={pickMediaStatus}
        >
          <Ionicons name="camera" size={24} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* Text Status Creator Modal */}
      <Modal visible={textModal} animationType="slide" onRequestClose={() => setTextModal(false)}>
        <SafeAreaView style={[styles.textCreator, { backgroundColor: BG_COLORS[bgIndex] }]}>
          <View style={styles.creatorTop}>
            <TouchableOpacity onPress={() => setTextModal(false)}>
              <Ionicons name="close" size={28} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.privacyPill}
              onPress={() =>
                setStatusPrivacy((p) =>
                  p === PrivacyVisibility.ALL ? PrivacyVisibility.CONTACTS : PrivacyVisibility.ALL,
                )
              }
            >
              <Ionicons
                name={statusPrivacy === PrivacyVisibility.ALL ? 'globe-outline' : 'people-outline'}
                size={15}
                color="#FFFFFF"
              />
              <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>
                {statusPrivacy === PrivacyVisibility.ALL ? 'Everyone' : 'Contacts Only'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setBgIndex((i) => (i + 1) % BG_COLORS.length)}>
              <Ionicons name="color-palette" size={26} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <TextInput
            value={statusText}
            onChangeText={setStatusText}
            placeholder="Type a status..."
            placeholderTextColor="rgba(255,255,255,0.65)"
            multiline
            autoFocus
            style={styles.creatorInput}
          />
          <TouchableOpacity
            style={styles.creatorSend}
            onPress={handleCreateTextStatus}
            disabled={posting || !statusText.trim()}
          >
            {posting ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="send" size={22} color="#FFFFFF" />}
          </TouchableOpacity>
        </SafeAreaView>
      </Modal>

      {/* Media Status Caption Modal */}
      <Modal visible={Boolean(mediaDraft)} animationType="slide" onRequestClose={() => setMediaDraft(null)}>
        <SafeAreaView style={[styles.textCreator, { backgroundColor: '#000000' }]}>
          <View style={styles.creatorTop}>
            <TouchableOpacity onPress={() => setMediaDraft(null)}>
              <Ionicons name="close" size={28} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.privacyPill}
              onPress={() =>
                setStatusPrivacy((p) =>
                  p === PrivacyVisibility.ALL ? PrivacyVisibility.CONTACTS : PrivacyVisibility.ALL,
                )
              }
            >
              <Ionicons
                name={statusPrivacy === PrivacyVisibility.ALL ? 'globe-outline' : 'people-outline'}
                size={15}
                color="#FFFFFF"
              />
              <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>
                {statusPrivacy === PrivacyVisibility.ALL ? 'Everyone' : 'Contacts Only'}
              </Text>
            </TouchableOpacity>
          </View>
          {mediaDraft && (
            <Image source={{ uri: mediaDraft.uri }} style={styles.previewImg} resizeMode="contain" />
          )}
          <View style={styles.captionBar}>
            <TextInput
              value={mediaCaption}
              onChangeText={setMediaCaption}
              placeholder="Add a caption..."
              placeholderTextColor="#9CA3AF"
              style={styles.captionInput}
            />
            <TouchableOpacity
              style={[styles.creatorSend, { position: 'relative', bottom: 0, right: 0 }]}
              onPress={handlePostMediaStatus}
              disabled={posting}
            >
              {posting ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="send" size={20} color="#FFFFFF" />}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  myStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatarRingWrap: { position: 'relative' },
  addBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  name: { fontSize: 16, fontWeight: '700', marginBottom: 2 },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 6,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  ring: {
    padding: 2,
    borderRadius: 30,
    borderWidth: 2.5,
  },
  emptyWrap: { padding: 48, alignItems: 'center', gap: 12 },
  fabColumn: { position: 'absolute', right: 20, bottom: 20, alignItems: 'center', gap: 14 },
  smallFab: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 5,
  },
  textCreator: { flex: 1, justifyContent: 'space-between', padding: 16 },
  creatorTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  privacyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.32)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  creatorInput: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  creatorSend: {
    position: 'absolute',
    right: 22,
    bottom: 26,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#00A884',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewImg: { flex: 1, width: '100%' },
  captionBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10 },
  captionInput: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.16)',
    color: '#FFFFFF',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
  },
});

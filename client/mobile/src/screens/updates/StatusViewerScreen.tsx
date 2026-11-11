import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ResizeMode, Video } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { Status, StatusContentType, StatusView } from '@whatsapp-pro/shared-types';
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

type Props = NativeStackScreenProps<RootStackParamList, 'StatusViewer'>;

const REACTIONS = ['❤️', '😂', '😮', '😢', '👏', '🔥'];

export function StatusViewerScreen({ route, navigation }: Props) {
  const { userId } = route.params;
  const theme = useTheme();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const isOwner = userId === currentUserId;

  const [statuses, setStatuses] = useState<Status[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [viewers, setViewers] = useState<StatusView[]>([]);
  const [viewersModal, setViewersModal] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.get(isOwner ? '/statuses/mine' : '/statuses');
        const rawList = unwrapApiData<Record<string, any>[]>(res.data) ?? [];
        const flat: Record<string, any>[] = [];
        for (const entry of rawList) {
          if (Array.isArray(entry.statuses)) {
            const owner = entry.user ?? entry.users;
            for (const item of entry.statuses) {
              flat.push({ ...item, user: item.user ?? item.users ?? owner });
            }
          } else {
            flat.push(entry);
          }
        }
        const filtered = flat
          .filter((s) => String(s.userId ?? s.user_id ?? s.user?.id ?? '') === userId)
          .map((raw) => ({
            id: String(raw.id),
            userId: String(raw.userId ?? raw.user_id ?? raw.user?.id ?? userId),
            contentType: (raw.contentType ?? raw.content_type ?? StatusContentType.TEXT) as StatusContentType,
            contentUrl: resolveMediaUrl((raw.contentUrl ?? raw.content_url ?? null) as string | null) ?? null,
            textContent: raw.textContent ?? raw.text_content ?? null,
            caption: raw.caption ?? null,
            backgroundColor: raw.backgroundColor ?? raw.background_color ?? '#075E54',
            privacy: raw.privacy,
            expiresAt: raw.expiresAt ?? raw.expires_at,
            createdAt: raw.createdAt ?? raw.created_at,
            user: raw.user || raw.users ? normalizeUser(raw.user ?? raw.users) : undefined,
          })) as Status[];
        if (active) setStatuses(filtered);
      } catch {
        // ignore
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [isOwner, userId]);

  const currentStatus = statuses[index];

  useEffect(() => {
    if (!currentStatus || isOwner) return;
    api.post(`/statuses/${currentStatus.id}/views`).catch(() => {});
  }, [currentStatus, isOwner]);

  useEffect(() => {
    if (!currentStatus || paused || viewersModal) return;
    const timer = setTimeout(() => {
      if (index < statuses.length - 1) {
        setIndex((i) => i + 1);
      } else {
        navigation.goBack();
      }
    }, 5500);
    return () => clearTimeout(timer);
  }, [currentStatus, index, navigation, paused, statuses.length, viewersModal]);

  const openViewers = async () => {
    if (!currentStatus) return;
    setPaused(true);
    setViewersModal(true);
    try {
      const res = await api.get(`/statuses/${currentStatus.id}/viewers`);
      const list = unwrapApiData<StatusView[]>(res.data) ?? [];
      setViewers(list);
    } catch {
      setViewers([]);
    }
  };

  const handleReact = async (emoji: string) => {
    if (!currentStatus) return;
    try {
      await api.post(`/statuses/${currentStatus.id}/reactions`, { emoji });
      Alert.alert('Reacted', `Sent ${emoji}`);
    } catch {
      // ignore
    }
  };

  const handleReply = async () => {
    if (!currentStatus || !replyText.trim()) return;
    try {
      await api.post(`/statuses/${currentStatus.id}/reply`, {
        message: replyText.trim(),
      });
      setReplyText('');
      Alert.alert('Reply Sent', 'Your reply was sent in chat.');
    } catch (err) {
      Alert.alert('Reply Failed', extractErrorMessage(err));
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: '#000', justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color="#FFFFFF" />
      </SafeAreaView>
    );
  }

  if (!currentStatus) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ color: '#FFFFFF' }}>Status unavailable or expired.</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: 16 }}>
          <Text style={{ color: '#00A884', fontWeight: '700' }}>Close</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[
        styles.container,
        {
          backgroundColor:
            currentStatus.contentType === StatusContentType.TEXT
              ? currentStatus.backgroundColor || '#075E54'
              : '#000000',
        },
      ]}
    >
      {/* Segmented progress bars */}
      <View style={styles.progressRow}>
        {statuses.map((st, idx) => (
          <View key={st.id} style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: idx <= index ? '100%' : '0%' },
              ]}
            />
          </View>
        ))}
      </View>

      {/* Top header */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ paddingRight: 8 }}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Avatar uri={currentStatus.user?.avatarUrl} name={currentStatus.user?.displayName || 'User'} size={38} />
        <View style={{ flex: 1 }}>
          <Text style={styles.authorName}>{currentStatus.user?.displayName || 'Status'}</Text>
          <Text style={styles.timeText}>
            {new Date(currentStatus.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      </View>

      {/* Content + Tap zones */}
      <Pressable
        style={styles.contentArea}
        onLongPress={() => setPaused(true)}
        onPressOut={() => setPaused(false)}
        onPress={(e) => {
          const x = e.nativeEvent.locationX;
          if (x < 120) {
            if (index > 0) setIndex((i) => i - 1);
          } else if (index < statuses.length - 1) {
            setIndex((i) => i + 1);
          } else {
            navigation.goBack();
          }
        }}
      >
        {currentStatus.contentType === StatusContentType.TEXT ? (
          <Text style={styles.textStatus}>{currentStatus.textContent}</Text>
        ) : currentStatus.contentType === StatusContentType.VIDEO && currentStatus.contentUrl ? (
          <Video
            source={{ uri: resolveMediaUrl(currentStatus.contentUrl) ?? currentStatus.contentUrl }}
            style={styles.media}
            resizeMode={ResizeMode.CONTAIN}
            shouldPlay={!paused}
            isLooping
            useNativeControls
          />
        ) : currentStatus.contentUrl ? (
          <Image
            source={{ uri: resolveMediaUrl(currentStatus.contentUrl) ?? currentStatus.contentUrl }}
            style={styles.media}
            resizeMode="contain"
          />
        ) : null}

        {currentStatus.caption ? (
          <View style={styles.captionBox}>
            <Text style={styles.captionText}>{currentStatus.caption}</Text>
          </View>
        ) : null}
      </Pressable>

      {/* Footer */}
      {isOwner ? (
        <TouchableOpacity style={styles.viewersBtn} onPress={openViewers}>
          <Ionicons name="eye" size={20} color="#FFFFFF" />
          <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Viewers</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.footerWrap}>
          <View style={styles.reactRow}>
            {REACTIONS.map((emoji) => (
              <TouchableOpacity key={emoji} onPress={() => handleReact(emoji)}>
                <Text style={{ fontSize: 24 }}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.replyRow}>
            <TextInput
              value={replyText}
              onChangeText={setReplyText}
              placeholder="Reply to status..."
              placeholderTextColor="#D1D5DB"
              onFocus={() => setPaused(true)}
              onBlur={() => setPaused(false)}
              style={styles.replyInput}
            />
            <TouchableOpacity onPress={handleReply} style={styles.sendBtn}>
              <Ionicons name="send" size={18} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Viewers Modal */}
      <Modal
        visible={viewersModal}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setViewersModal(false);
          setPaused(false);
        }}
      >
        <View style={[styles.viewersSheet, { backgroundColor: theme.surfaceElevated }]}>
          <View style={styles.viewersHeader}>
            <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>
              Viewed by {viewers.length}
            </Text>
            <TouchableOpacity
              onPress={() => {
                setViewersModal(false);
                setPaused(false);
              }}
            >
              <Ionicons name="close" size={24} color={theme.text} />
            </TouchableOpacity>
          </View>
          <FlatList
            data={viewers}
            keyExtractor={(v) => v.id}
            renderItem={({ item }) => (
              <View style={styles.viewerRow}>
                <Avatar uri={item.viewer?.avatarUrl} name={item.viewer?.displayName} size={40} />
                <View>
                  <Text style={{ color: theme.text, fontWeight: '600' }}>
                    {item.viewer?.displayName || 'User'}
                  </Text>
                  <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                    {new Date(item.viewedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
              </View>
            )}
            ListEmptyComponent={
              <Text style={{ color: theme.textMuted, padding: 24, textAlign: 'center' }}>
                No viewers yet
              </Text>
            }
          />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  progressRow: { flexDirection: 'row', gap: 4, paddingHorizontal: 10, paddingTop: 10 },
  progressTrack: { flex: 1, height: 3, backgroundColor: 'rgba(255,255,255,0.35)', borderRadius: 2 },
  progressFill: { height: 3, backgroundColor: '#FFFFFF', borderRadius: 2 },
  topBar: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 },
  authorName: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  timeText: { color: 'rgba(255,255,255,0.75)', fontSize: 12 },
  contentArea: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  textStatus: { color: '#FFFFFF', fontSize: 28, fontWeight: '700', textAlign: 'center' },
  media: { width: '100%', height: '100%' },
  captionBox: {
    position: 'absolute',
    bottom: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  captionText: { color: '#FFFFFF', fontSize: 15, textAlign: 'center' },
  viewersBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  footerWrap: { padding: 12, gap: 10 },
  reactRow: { flexDirection: 'row', justifyContent: 'space-around' },
  replyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  replyInput: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.18)',
    color: '#FFFFFF',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#00A884',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewersSheet: {
    marginTop: 'auto',
    height: '50%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
  },
  viewersHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  viewerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
});

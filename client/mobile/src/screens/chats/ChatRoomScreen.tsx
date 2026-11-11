import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Location from 'expo-location';
import * as Contacts from 'expo-contacts';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { CallType, ConversationType, MessageType } from '@whatsapp-pro/shared-types';
import socketService from '../../services/socket';
import { useChatStore } from '../../stores/chatStore';
import { useAuthStore } from '../../stores/authStore';
import { useCallStore } from '../../stores/callStore';
import { useThemeStore } from '../../stores/themeStore';
import { useTheme } from '../../theme/colors';
import { extractErrorMessage, MobileMessage, RootStackParamList } from '../../types/mobile.types';
import { Avatar } from '../../components/Avatar';
import { MessageBubble } from '../../components/MessageBubble';
import { MessageActionSheet } from '../../components/MessageActionSheet';
import { AttachmentSheet } from '../../components/AttachmentSheet';
import { VoiceRecorderButton } from '../../components/VoiceRecorderBar';

type Props = NativeStackScreenProps<RootStackParamList, 'ChatRoom'>;

export function ChatRoomScreen({ route, navigation }: Props) {
  const { conversationId, title, avatarUrl, peerUserId } = route.params;
  const theme = useTheme();
  const currentUserId = useAuthStore((s) => s.user?.id ?? '');
  const { enterToSend } = useThemeStore();
  const { initiateCall } = useCallStore();
  const {
    conversations,
    messagesByConv,
    hasMoreByConv,
    isLoadingMessages,
    typingUsers,
    onlineUsers,
    replyingTo,
    editingMessage,
    setActiveConversation,
    setReplyingTo,
    setEditingMessage,
    fetchMessages,
    sendMessage,
    uploadMediaFile,
    editMessage,
    deleteMessage,
    toggleReaction,
    votePoll,
    starMessage,
    forwardMessage,
    markConversationRead,
  } = useChatStore();

  const conversation = useMemo(
    () => conversations.find((c) => c.id === conversationId),
    [conversations, conversationId],
  );
  const messages = messagesByConv[conversationId] ?? [];
  const isLoading = isLoadingMessages[conversationId] ?? false;
  const hasMore = hasMoreByConv[conversationId] ?? true;

  const resolvedTitle = conversation?.title || title || 'Chat';
  const resolvedAvatar = conversation?.avatarUrl ?? avatarUrl;
  const resolvedPeerId = conversation?.peerUser?.id ?? peerUserId;
  const isPeerOnline = resolvedPeerId ? Boolean(onlineUsers[resolvedPeerId]) : false;
  const isTyping = (typingUsers[conversationId] ?? []).length > 0;

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [selectedMsg, setSelectedMsg] = useState<MobileMessage | null>(null);
  const [attachmentVisible, setAttachmentVisible] = useState(false);
  const [forwardModalMsg, setForwardModalMsg] = useState<MobileMessage | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendingRef = useRef(false);

  useEffect(() => {
    setActiveConversation(conversationId);
    socketService.joinConversation(conversationId);
    fetchMessages(conversationId, false).then(() => markConversationRead(conversationId));

    const syncInterval = setInterval(() => {
      fetchMessages(conversationId, false, true).catch(() => {});
    }, 4000);

    return () => {
      clearInterval(syncInterval);
      setActiveConversation(null);
      socketService.leaveConversation(conversationId);
      socketService.sendTyping(conversationId, false);
      setReplyingTo(null);
      setEditingMessage(null);
    };
  }, [
    conversationId,
    fetchMessages,
    markConversationRead,
    setActiveConversation,
    setEditingMessage,
    setReplyingTo,
  ]);

  useEffect(() => {
    if (editingMessage) {
      setText(editingMessage.decryptedContent ?? editingMessage.content ?? '');
    }
  }, [editingMessage]);

  const startCall = async (callType: CallType) => {
    const peerIds = (conversation?.members ?? [])
      .map((m) => m.userId)
      .filter((id) => id && id !== currentUserId);
    try {
      const callId = await initiateCall({
        conversationId,
        callType,
        peerName: resolvedTitle,
        peerAvatar: resolvedAvatar,
        peerUserIds: peerIds.length > 0 ? peerIds : resolvedPeerId ? [resolvedPeerId] : [],
      });
      navigation.navigate('ActiveCall', {
        callId,
        conversationId,
        callType,
        peerName: resolvedTitle,
        peerAvatar: resolvedAvatar,
        isCaller: true,
      });
    } catch (err) {
      Alert.alert('Call Failed', extractErrorMessage(err));
    }
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <TouchableOpacity
          style={styles.headerTitleWrap}
          onPress={() => {
            if (conversation?.groupId) {
              navigation.navigate('GroupInfo', {
                groupId: conversation.groupId,
                conversationId,
              });
            }
          }}
        >
          <Avatar
            uri={resolvedAvatar}
            name={resolvedTitle}
            size={36}
            isOnline={isPeerOnline}
            isGroup={conversation?.type !== ConversationType.DIRECT}
          />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={[styles.headerName, { color: theme.headerText }]}>
              {resolvedTitle}
            </Text>
            <Text numberOfLines={1} style={[styles.headerSub, { color: 'rgba(255,255,255,0.82)' }]}>
              {isTyping
                ? 'typing...'
                : conversation?.type !== ConversationType.DIRECT
                  ? `${conversation?.members?.length ?? 0} participants`
                  : isPeerOnline
                    ? 'online'
                    : 'tap for info'}
            </Text>
          </View>
        </TouchableOpacity>
      ),
      headerRight: () => (
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => startCall(CallType.VIDEO)} style={styles.headerIcon}>
            <Ionicons name="videocam" size={22} color={theme.headerText} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => startCall(CallType.AUDIO)} style={styles.headerIcon}>
            <Ionicons name="call" size={20} color={theme.headerText} />
          </TouchableOpacity>
          {conversation?.groupId ? (
            <TouchableOpacity
              onPress={() =>
                navigation.navigate('GroupInfo', {
                  groupId: conversation.groupId!,
                  conversationId,
                })
              }
              style={styles.headerIcon}
            >
              <Ionicons name="information-circle-outline" size={22} color={theme.headerText} />
            </TouchableOpacity>
          ) : null}
        </View>
      ),
    });
  });

  const handleTextChange = (val: string) => {
    setText(val);
    socketService.sendTyping(conversationId, val.length > 0);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socketService.sendTyping(conversationId, false);
    }, 2500);
  };

  const handleSendText = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    socketService.sendTyping(conversationId, false);
    try {
      if (editingMessage) {
        await editMessage(editingMessage.id, conversationId, trimmed);
        setText('');
      } else {
        setText('');
        await sendMessage({
          conversationId,
          messageType: MessageType.TEXT,
          content: trimmed,
          replyToId: replyingTo?.id,
        });
      }
    } catch (err) {
      Alert.alert('Send Failed', extractErrorMessage(err));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const handlePickCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Camera permission is required to take photos.');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (res.canceled || !res.assets[0]) return;
    await sendPickedMedia(res.assets[0]);
  };

  const handlePickGallery = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Gallery permission is required.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 0.85,
    });
    if (res.canceled || !res.assets[0]) return;
    await sendPickedMedia(res.assets[0]);
  };

  const sendPickedMedia = async (asset: ImagePicker.ImagePickerAsset) => {
    setSending(true);
    try {
      const isVideo = asset.type === 'video';
      const uploaded = await uploadMediaFile({
        uri: asset.uri,
        name: asset.fileName || `media-${Date.now()}.${isVideo ? 'mp4' : 'jpg'}`,
        type: asset.mimeType || (isVideo ? 'video/mp4' : 'image/jpeg'),
      });
      await sendMessage({
        conversationId,
        messageType: isVideo ? MessageType.VIDEO : MessageType.IMAGE,
        attachmentUrl: uploaded.url,
        attachmentName: uploaded.fileName,
        attachmentSize: uploaded.fileSize,
        mimeType: uploaded.mimeType,
        replyToId: replyingTo?.id,
      });
    } catch (err) {
      Alert.alert('Upload Failed', extractErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const handlePickDocument = async () => {
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (res.canceled || !res.assets[0]) return;
    const doc = res.assets[0];
    setSending(true);
    try {
      const uploaded = await uploadMediaFile({
        uri: doc.uri,
        name: doc.name,
        type: doc.mimeType || 'application/octet-stream',
      });
      await sendMessage({
        conversationId,
        messageType: MessageType.DOCUMENT,
        content: doc.name,
        attachmentUrl: uploaded.url,
        attachmentName: doc.name,
        attachmentSize: doc.size,
        mimeType: doc.mimeType,
      });
    } catch (err) {
      Alert.alert('Document Upload Failed', extractErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const handlePickLocation = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Location access is required to share your location.');
      return;
    }
    setSending(true);
    try {
      const pos = await Location.getCurrentPositionAsync({});
      await sendMessage({
        conversationId,
        messageType: MessageType.LOCATION,
        content: JSON.stringify({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          label: 'Current Location',
        }),
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });
    } catch (err) {
      Alert.alert('Location Failed', extractErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const handlePickContact = async () => {
    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Contacts access is required.');
      return;
    }
    const { data } = await Contacts.getContactsAsync({
      fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
      pageSize: 10,
    });
    const firstWithPhone = data.find((c) => (c.phoneNumbers?.length ?? 0) > 0);
    if (!firstWithPhone) {
      Alert.alert('No Contacts', 'No contacts with phone numbers found.');
      return;
    }
    const contactName = firstWithPhone.name || 'Contact';
    const contactPhone = firstWithPhone.phoneNumbers?.[0]?.number || '';
    await sendMessage({
      conversationId,
      messageType: MessageType.CONTACT,
      content: JSON.stringify({ name: contactName, phone: contactPhone }),
      contactName,
      contactPhone,
    });
  };

  const handleSendVoiceNote = async (uri: string, durationSeconds: number) => {
    setSending(true);
    try {
      const uploaded = await uploadMediaFile({
        uri,
        name: `voice-${Date.now()}.m4a`,
        type: 'audio/m4a',
      });
      await sendMessage({
        conversationId,
        messageType: MessageType.VOICE,
        attachmentUrl: uploaded.url,
        attachmentName: uploaded.fileName,
        attachmentSize: uploaded.fileSize,
        mimeType: 'audio/m4a',
        duration: durationSeconds,
      });
    } catch (err) {
      Alert.alert('Voice Note Failed', extractErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const handleCreatePoll = async (question: string, options: string[]) => {
    await sendMessage({
      conversationId,
      messageType: MessageType.POLL,
      content: JSON.stringify({
        question,
        options: options.map((o) => ({ text: o, votes: 0 })),
      }),
      encryptIfDirect: false,
    });
  };

  const formatDisappearingBanner = (seconds?: number | null) => {
    if (!seconds) return null;
    if (seconds === 86400) return 'Disappearing messages are on (24 hours).';
    if (seconds === 604800) return 'Disappearing messages are on (7 days).';
    return `Disappearing messages are on (${Math.round(seconds / 86400)} days).`;
  };

  const disappearingText = formatDisappearingBanner(conversation?.disappearingMessagesTimeout);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.chatWallpaper }]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
        {disappearingText && (
          <View style={[styles.banner, { backgroundColor: theme.surfaceElevated }]}>
            <Ionicons name="timer-outline" size={15} color={theme.primary} />
            <Text style={{ fontSize: 12, color: theme.textSecondary }}>{disappearingText}</Text>
          </View>
        )}

        <FlatList
          inverted
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          onEndReached={() => {
            if (hasMore && !isLoading) {
              fetchMessages(conversationId, true).catch(() => {});
            }
          }}
          onEndReachedThreshold={0.35}
          ListFooterComponent={
            isLoading ? (
              <View style={styles.loaderWrap}>
                <ActivityIndicator size="small" color={theme.primary} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            !isLoading ? (
              <View style={styles.emptyWrap}>
                <View style={[styles.e2eeBanner, { backgroundColor: theme.surfaceElevated }]}>
                  <Ionicons name="lock-closed" size={14} color={theme.primary} />
                  <Text style={[styles.e2eeText, { color: theme.textSecondary }]}>
                    Messages and calls are end-to-end encrypted. Say hello!
                  </Text>
                </View>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              isOwn={item.senderId === currentUserId}
              showSenderName={conversation?.type !== ConversationType.DIRECT}
              onLongPress={(msg) => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                setSelectedMsg(msg);
              }}
              onVotePoll={(msg, idx) => votePoll(msg.id, conversationId, idx).catch(() => {})}
            />
          )}
        />

        {/* Reply / Edit Preview Bar */}
        {(replyingTo || editingMessage) && (
          <View
            style={[
              styles.replyBar,
              { backgroundColor: theme.surfaceElevated, borderTopColor: theme.border },
            ]}
          >
            <View style={[styles.replyAccent, { backgroundColor: theme.primary }]} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.primary, fontWeight: '700', fontSize: 12 }}>
                {editingMessage
                  ? 'Editing message'
                  : `Replying to ${replyingTo?.sender?.displayName || 'Message'}`}
              </Text>
              <Text numberOfLines={1} style={{ color: theme.textSecondary, fontSize: 13 }}>
                {(editingMessage ?? replyingTo)?.decryptedContent ||
                  (editingMessage ?? replyingTo)?.content ||
                  (editingMessage ?? replyingTo)?.messageType}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => {
                setReplyingTo(null);
                setEditingMessage(null);
                if (editingMessage) setText('');
              }}
            >
              <Ionicons name="close" size={20} color={theme.textMuted} />
            </TouchableOpacity>
          </View>
        )}

        {/* Composer */}
        <View style={[styles.composerRow, { backgroundColor: 'transparent' }]}>
          <View style={[styles.inputPill, { backgroundColor: theme.inputBg, borderColor: theme.border }]}>
            <TouchableOpacity onPress={() => setAttachmentVisible(true)} style={styles.attachBtn}>
              <Ionicons name="attach" size={22} color={theme.textSecondary} />
            </TouchableOpacity>
            <TextInput
              value={text}
              onChangeText={handleTextChange}
              placeholder="Message"
              placeholderTextColor={theme.textMuted}
              multiline
              returnKeyType={enterToSend ? 'send' : 'default'}
              onSubmitEditing={enterToSend ? handleSendText : undefined}
              style={[styles.textInput, { color: theme.text }]}
            />
            <TouchableOpacity onPress={handlePickCamera} style={styles.attachBtn}>
              <Ionicons name="camera-outline" size={22} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>

          {text.trim().length > 0 || editingMessage ? (
            <TouchableOpacity
              onPress={handleSendText}
              disabled={sending}
              style={[styles.sendBtn, { backgroundColor: theme.primary }]}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name={editingMessage ? 'checkmark' : 'send'} size={20} color="#FFFFFF" />
              )}
            </TouchableOpacity>
          ) : (
            <VoiceRecorderButton onSendVoiceNote={handleSendVoiceNote} />
          )}
        </View>
      </KeyboardAvoidingView>

      <MessageActionSheet
        message={selectedMsg}
        isOwn={selectedMsg?.senderId === currentUserId}
        onClose={() => setSelectedMsg(null)}
        onReact={(emoji) =>
          selectedMsg && toggleReaction(selectedMsg.id, conversationId, emoji).catch(() => {})
        }
        onReply={() => selectedMsg && setReplyingTo(selectedMsg)}
        onForward={() => selectedMsg && setForwardModalMsg(selectedMsg)}
        onEdit={() => selectedMsg && setEditingMessage(selectedMsg)}
        onCopy={async () => {
          if (selectedMsg) {
            await Clipboard.setStringAsync(
              selectedMsg.decryptedContent ?? selectedMsg.content ?? '',
            );
          }
        }}
        onStar={() =>
          selectedMsg && starMessage(selectedMsg.id, conversationId, !selectedMsg.isStarred).catch(() => {})
        }
        onDeleteForMe={() =>
          selectedMsg && deleteMessage(selectedMsg.id, conversationId, false).catch(() => {})
        }
        onDeleteForEveryone={() =>
          selectedMsg && deleteMessage(selectedMsg.id, conversationId, true).catch(() => {})
        }
      />

      <AttachmentSheet
        visible={attachmentVisible}
        onClose={() => setAttachmentVisible(false)}
        onPickCamera={handlePickCamera}
        onPickGallery={handlePickGallery}
        onPickDocument={handlePickDocument}
        onPickLocation={handlePickLocation}
        onPickContact={handlePickContact}
        onCreatePoll={handleCreatePoll}
      />

      {/* Forward Conversation Picker Modal */}
      <Modal
        visible={Boolean(forwardModalMsg)}
        animationType="slide"
        onRequestClose={() => setForwardModalMsg(null)}
      >
        <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
          <View style={[styles.forwardHeader, { backgroundColor: theme.headerBg }]}>
            <TouchableOpacity onPress={() => setForwardModalMsg(null)}>
              <Ionicons name="close" size={24} color={theme.headerText} />
            </TouchableOpacity>
            <Text style={{ color: theme.headerText, fontSize: 18, fontWeight: '700' }}>
              Forward to...
            </Text>
          </View>
          <FlatList
            data={conversations.filter((c) => c.id !== conversationId)}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.forwardRow, { borderBottomColor: theme.divider }]}
                onPress={async () => {
                  if (!forwardModalMsg) return;
                  try {
                    await forwardMessage(forwardModalMsg.id, item.id);
                    setForwardModalMsg(null);
                    Alert.alert('Forwarded', `Message sent to ${item.title}`);
                  } catch (err) {
                    Alert.alert('Forward Failed', extractErrorMessage(err));
                  }
                }}
              >
                <Avatar uri={item.avatarUrl} name={item.title} size={44} />
                <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>
                  {item.title}
                </Text>
              </TouchableOpacity>
            )}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: 200 },
  headerName: { fontSize: 16, fontWeight: '700' },
  headerSub: { fontSize: 12 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  headerIcon: { padding: 4 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  listContent: { paddingVertical: 10 },
  loaderWrap: { paddingVertical: 14, alignItems: 'center' },
  emptyWrap: {
    transform: [{ scaleY: -1 }],
    padding: 24,
    alignItems: 'center',
  },
  e2eeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  e2eeText: { fontSize: 12, textAlign: 'center', flexShrink: 1 },
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  replyAccent: { width: 4, height: 34, borderRadius: 2 },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 8,
  },
  inputPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 44,
    maxHeight: 120,
  },
  attachBtn: { padding: 6 },
  textInput: { flex: 1, fontSize: 16, paddingVertical: 4, paddingHorizontal: 4, maxHeight: 100 },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  forwardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  forwardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});

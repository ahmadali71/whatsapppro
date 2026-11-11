import React, { useEffect, useRef, useState } from 'react';
import {
  Image,
  Linking,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Audio, ResizeMode, Video } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { MessageType } from '@whatsapp-pro/shared-types';
import { MobileMessage } from '../types/mobile.types';
import { resolveMediaUrl } from '../services/api';
import { useTheme } from '../theme/colors';

interface Props {
  message: MobileMessage;
  isOwn: boolean;
  showSenderName?: boolean;
  onLongPress: (msg: MobileMessage) => void;
  onPressReplyQuote?: (replyToId: string) => void;
  onVotePoll?: (msg: MobileMessage, optionIndex: number) => void;
}

const WAVEFORM_BARS = [6, 12, 18, 9, 22, 14, 10, 20, 16, 8, 18, 12, 22, 14, 9, 17, 11, 15, 8, 12];

export function MessageBubble({
  message,
  isOwn,
  showSenderName,
  onLongPress,
  onPressReplyQuote,
  onVotePoll,
}: Props) {
  const theme = useTheme();
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [viewOnceOpened, setViewOnceOpened] = useState(false);
  const [videoModalUrl, setVideoModalUrl] = useState<string | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  const displayText = message.isDeletedForEveryone
    ? 'This message was deleted'
    : message.decryptedContent ?? message.content ?? '';

  const attachment = message.attachments?.[0];

  const toggleVoicePlayback = async () => {
    const uri = resolveMediaUrl(attachment?.fileUrl);
    if (!uri) return;
    try {
      if (isPlaying && soundRef.current) {
        await soundRef.current.pauseAsync();
        setIsPlaying(false);
        return;
      }
      if (!soundRef.current) {
        const { sound } = await Audio.Sound.createAsync(
          { uri },
          { shouldPlay: true },
          (status) => {
            if (!status.isLoaded) return;
            if (status.durationMillis && status.durationMillis > 0) {
              setPlaybackProgress(status.positionMillis / status.durationMillis);
            }
            if (status.didJustFinish) {
              setIsPlaying(false);
              setPlaybackProgress(0);
              sound.setPositionAsync(0).catch(() => {});
            }
          },
        );
        soundRef.current = sound;
        setIsPlaying(true);
      } else {
        await soundRef.current.playAsync();
        setIsPlaying(true);
      }
    } catch {
      setIsPlaying(false);
    }
  };

  const renderTicks = () => {
    if (!isOwn) return null;
    if (message.localStatus === 'SENDING') {
      return <Ionicons name="time-outline" size={14} color={theme.tickDefault} />;
    }
    if (message.localStatus === 'FAILED') {
      return <Ionicons name="alert-circle" size={14} color={theme.danger} />;
    }
    if (message.readAt) {
      return <Ionicons name="checkmark-done" size={15} color={theme.tickRead} />;
    }
    if (message.deliveredAt) {
      return <Ionicons name="checkmark-done" size={15} color={theme.tickDefault} />;
    }
    return <Ionicons name="checkmark" size={15} color={theme.tickDefault} />;
  };

  const renderBody = () => {
    if (message.isDeletedForEveryone) {
      return (
        <View style={styles.deletedRow}>
          <Ionicons name="ban-outline" size={14} color={theme.textMuted} />
          <Text style={[styles.deletedText, { color: theme.textMuted }]}>{displayText}</Text>
        </View>
      );
    }

    if (message.isViewOnce && !viewOnceOpened) {
      return (
        <TouchableOpacity
          style={styles.viewOnceBtn}
          onPress={() => setViewOnceOpened(true)}
        >
          <Ionicons name="eye-outline" size={18} color={theme.primary} />
          <Text style={[styles.viewOnceText, { color: theme.text }]}>Tap to view once</Text>
        </TouchableOpacity>
      );
    }

    switch (message.messageType) {
      case MessageType.IMAGE:
      case MessageType.STICKER:
      case MessageType.GIF: {
        const uri = resolveMediaUrl(attachment?.fileUrl || message.content);
        return (
          <View>
            {uri ? (
              <Image
                source={{ uri }}
                style={[
                  styles.mediaImage,
                  message.messageType === MessageType.STICKER && styles.stickerImage,
                ]}
                resizeMode="cover"
              />
            ) : null}
            {displayText && displayText !== uri ? (
              <Text style={[styles.bodyText, { color: theme.text, marginTop: 6, fontSize: 15 * theme.fontSizeScale }]}>
                {displayText}
              </Text>
            ) : null}
          </View>
        );
      }

      case MessageType.VIDEO: {
        const thumb = attachment?.thumbnailUrl ? resolveMediaUrl(attachment.thumbnailUrl) : null;
        const videoUrl = resolveMediaUrl(attachment?.fileUrl);
        return (
          <TouchableOpacity
            onPress={() => videoUrl && setVideoModalUrl(videoUrl)}
            style={styles.videoCard}
          >
            {thumb ? (
              <Image source={{ uri: thumb }} style={styles.mediaImage} />
            ) : (
              <View style={[styles.mediaImage, styles.videoPlaceholder]}>
                <Ionicons name="videocam" size={30} color="rgba(255,255,255,0.65)" />
                <Text numberOfLines={1} style={styles.videoLabel}>
                  {attachment?.fileName || 'Tap to play video'}
                </Text>
              </View>
            )}
            <View style={styles.playOverlay}>
              <Ionicons name="play-circle" size={44} color="#FFFFFF" />
            </View>
            {displayText ? (
              <Text style={[styles.bodyText, { color: theme.text, marginTop: 6 }]}>{displayText}</Text>
            ) : null}
          </TouchableOpacity>
        );
      }

      case MessageType.VOICE:
      case MessageType.AUDIO: {
        const durationSec = attachment?.duration ?? 0;
        const mins = Math.floor(durationSec / 60);
        const secs = Math.floor(durationSec % 60);
        return (
          <View style={styles.voiceRow}>
            <TouchableOpacity onPress={toggleVoicePlayback} style={styles.voicePlayBtn}>
              <Ionicons
                name={isPlaying ? 'pause' : 'play'}
                size={22}
                color={theme.primary}
              />
            </TouchableOpacity>
            <View style={styles.waveformWrap}>
              <View style={styles.waveformBars}>
                {WAVEFORM_BARS.map((h, idx) => {
                  const active = idx / WAVEFORM_BARS.length <= playbackProgress;
                  return (
                    <View
                      key={idx}
                      style={[
                        styles.waveBar,
                        {
                          height: h,
                          backgroundColor: active ? theme.primary : theme.textMuted,
                        },
                      ]}
                    />
                  );
                })}
              </View>
              <Text style={[styles.voiceDuration, { color: theme.textSecondary }]}>
                {`${mins}:${secs < 10 ? '0' : ''}${secs}`}
              </Text>
            </View>
          </View>
        );
      }

      case MessageType.DOCUMENT: {
        const fileName = attachment?.fileName || displayText || 'Document';
        const sizeKb = attachment?.fileSize ? `${Math.round(attachment.fileSize / 1024)} KB` : '';
        const docUrl = resolveMediaUrl(attachment?.fileUrl);
        return (
          <TouchableOpacity
            style={[styles.docCard, { backgroundColor: theme.isDark ? '#182229' : '#F4F6F7' }]}
            onPress={() => docUrl && Linking.openURL(docUrl)}
          >
            <Ionicons name="document-text" size={28} color={theme.primary} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={[styles.docTitle, { color: theme.text }]}>
                {fileName}
              </Text>
              {sizeKb ? (
                <Text style={{ fontSize: 11, color: theme.textMuted }}>{sizeKb}</Text>
              ) : null}
            </View>
            <Ionicons name="download-outline" size={20} color={theme.textSecondary} />
          </TouchableOpacity>
        );
      }

      case MessageType.LOCATION: {
        let parsed: { latitude?: number; longitude?: number; label?: string } = {};
        try {
          parsed = JSON.parse(displayText || '{}');
        } catch {
          // ignore
        }
        const lat = parsed.latitude ?? 0;
        const lng = parsed.longitude ?? 0;
        return (
          <TouchableOpacity
            style={[styles.docCard, { backgroundColor: theme.isDark ? '#182229' : '#F4F6F7' }]}
            onPress={() => Linking.openURL(`https://maps.google.com/?q=${lat},${lng}`)}
          >
            <Ionicons name="location" size={28} color={theme.danger} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.docTitle, { color: theme.text }]}>
                {parsed.label || 'Shared Location'}
              </Text>
              <Text style={{ fontSize: 12, color: theme.textSecondary }}>
                {lat.toFixed(4)}, {lng.toFixed(4)}
              </Text>
            </View>
          </TouchableOpacity>
        );
      }

      case MessageType.CONTACT: {
        let contact: { name?: string; phone?: string } = {};
        try {
          contact = JSON.parse(displayText || '{}');
        } catch {
          contact = { name: displayText || 'Contact' };
        }
        return (
          <View style={[styles.docCard, { backgroundColor: theme.isDark ? '#182229' : '#F4F6F7' }]}>
            <Ionicons name="person-circle" size={32} color={theme.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.docTitle, { color: theme.text }]}>{contact.name || 'Contact'}</Text>
              {contact.phone ? (
                <Text style={{ fontSize: 12, color: theme.textSecondary }}>{contact.phone}</Text>
              ) : null}
            </View>
          </View>
        );
      }

      case MessageType.POLL: {
        let poll: { question?: string; options?: Array<{ text: string; votes?: number | string[] }> } = {};
        try {
          poll = JSON.parse(displayText || '{}');
        } catch {
          poll = { question: displayText, options: [] };
        }
        return (
          <View style={{ minWidth: 210 }}>
            <Text style={[styles.pollQuestion, { color: theme.text }]}>
              📊 {poll.question || 'Poll'}
            </Text>
            {(poll.options ?? []).map((opt, idx) => {
              const voteCount = Array.isArray(opt.votes) ? opt.votes.length : (opt.votes ?? 0);
              return (
                <TouchableOpacity
                  key={idx}
                  style={[styles.pollOption, { borderColor: theme.border }]}
                  onPress={() => onVotePoll?.(message, idx)}
                >
                  <Text style={{ color: theme.text, flex: 1 }}>{opt.text}</Text>
                  <Text style={{ color: theme.primary, fontWeight: '600' }}>{voteCount}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        );
      }

      default:
        return (
          <Text style={[styles.bodyText, { color: theme.text, fontSize: 15 * theme.fontSizeScale }]}>
            {displayText}
          </Text>
        );
    }
  };

  const formattedTime = new Date(message.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const reactionGroups = (message.reactions ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.emoji] = (acc[r.emoji] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <View style={[styles.wrapper, isOwn ? styles.wrapperOwn : styles.wrapperOther]}>
      <Pressable
        onLongPress={() => onLongPress(message)}
        delayLongPress={250}
        style={[
          styles.bubble,
          {
            backgroundColor: isOwn ? theme.outgoingBubble : theme.incomingBubble,
            borderTopRightRadius: isOwn ? 4 : 14,
            borderTopLeftRadius: isOwn ? 14 : 4,
          },
        ]}
      >
        {showSenderName && !isOwn && message.sender?.displayName ? (
          <Text style={[styles.senderName, { color: theme.primary }]}>
            {message.sender.displayName}
          </Text>
        ) : null}

        {message.forwardedFromId ? (
          <View style={styles.forwardedRow}>
            <Ionicons name="arrow-redo" size={12} color={theme.textMuted} />
            <Text style={[styles.forwardedText, { color: theme.textMuted }]}>Forwarded</Text>
          </View>
        ) : null}

        {message.replyTo ? (
          <TouchableOpacity
            onPress={() => onPressReplyQuote?.(message.replyTo!.id)}
            style={[
              styles.replyBox,
              {
                borderLeftColor: theme.primary,
                backgroundColor: theme.isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.05)',
              },
            ]}
          >
            <Text style={[styles.replyAuthor, { color: theme.primary }]} numberOfLines={1}>
              {message.replyTo.sender?.displayName || 'Message'}
            </Text>
            <Text style={[styles.replyPreview, { color: theme.textSecondary }]} numberOfLines={1}>
              {message.replyTo.decryptedContent || message.replyTo.content || message.replyTo.messageType}
            </Text>
          </TouchableOpacity>
        ) : null}

        {renderBody()}

        <View style={styles.metaRow}>
          {message.isEncrypted ? (
            <Ionicons name="lock-closed" size={10} color={theme.textMuted} />
          ) : null}
          {message.isStarred ? (
            <Ionicons name="star" size={11} color={theme.warning} />
          ) : null}
          {message.isEdited ? (
            <Text style={[styles.metaText, { color: theme.textMuted }]}>edited</Text>
          ) : null}
          <Text style={[styles.metaText, { color: theme.textMuted }]}>{formattedTime}</Text>
          {renderTicks()}
        </View>
      </Pressable>

      {Object.keys(reactionGroups).length > 0 && (
        <View
          style={[
            styles.reactionBar,
            { backgroundColor: theme.surfaceElevated, borderColor: theme.border },
          ]}
        >
          {Object.entries(reactionGroups).map(([emoji, count]) => (
            <Text key={emoji} style={[styles.reactionPill, { color: theme.text }]}>
              {emoji} {count > 1 ? count : ''}
            </Text>
          ))}
        </View>
      )}

      <Modal
        visible={Boolean(videoModalUrl)}
        animationType="fade"
        transparent
        onRequestClose={() => setVideoModalUrl(null)}
      >
        <SafeAreaView style={styles.videoModalBackdrop}>
          <View style={styles.videoModalTopBar}>
            <TouchableOpacity onPress={() => setVideoModalUrl(null)} style={styles.videoCloseBtn}>
              <Ionicons name="close" size={26} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          {videoModalUrl ? (
            <Video
              source={{ uri: videoModalUrl }}
              style={styles.videoPlayer}
              resizeMode={ResizeMode.CONTAIN}
              useNativeControls
              shouldPlay
            />
          ) : null}
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginVertical: 3,
    paddingHorizontal: 10,
    maxWidth: '84%',
  },
  wrapperOwn: {
    alignSelf: 'flex-end',
  },
  wrapperOther: {
    alignSelf: 'flex-start',
  },
  bubble: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  senderName: { fontSize: 12, fontWeight: '700', marginBottom: 3 },
  forwardedRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3 },
  forwardedText: { fontSize: 11, fontStyle: 'italic' },
  replyBox: {
    borderLeftWidth: 3,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginBottom: 6,
  },
  replyAuthor: { fontSize: 12, fontWeight: '700' },
  replyPreview: { fontSize: 12 },
  bodyText: { lineHeight: 20 },
  deletedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  deletedText: { fontStyle: 'italic', fontSize: 14 },
  viewOnceBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  viewOnceText: { fontWeight: '600', fontSize: 14 },
  mediaImage: { width: 220, height: 220, borderRadius: 10 },
  stickerImage: { width: 140, height: 140, backgroundColor: 'transparent' },
  videoCard: { position: 'relative' },
  playOverlay: {
    position: 'absolute',
    top: 85,
    left: 88,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 24,
  },
  voiceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 200, paddingVertical: 4 },
  voicePlayBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waveformWrap: { flex: 1 },
  waveformBars: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 24 },
  waveBar: { width: 3, borderRadius: 2 },
  voiceDuration: { fontSize: 11, marginTop: 2 },
  docCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 10,
    minWidth: 210,
  },
  docTitle: { fontSize: 14, fontWeight: '600' },
  pollQuestion: { fontSize: 15, fontWeight: '700', marginBottom: 8 },
  pollOption: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 6,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 4,
  },
  metaText: { fontSize: 11 },
  reactionBar: {
    flexDirection: 'row',
    alignSelf: 'flex-end',
    marginTop: -6,
    marginRight: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
  },
  reactionPill: { fontSize: 12 },
  videoPlaceholder: {
    backgroundColor: '#111B21',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    gap: 8,
  },
  videoLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 28 },
  videoModalBackdrop: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
  },
  videoModalTopBar: {
    position: 'absolute',
    top: 40,
    right: 16,
    zIndex: 10,
  },
  videoCloseBtn: {
    padding: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 20,
  },
  videoPlayer: {
    width: '100%',
    height: '75%',
  },
});

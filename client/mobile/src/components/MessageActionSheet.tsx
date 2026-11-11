import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MessageType } from '@whatsapp-pro/shared-types';
import { MobileMessage } from '../types/mobile.types';
import { useTheme } from '../theme/colors';

const QUICK_EMOJIS = ['❤️', '👍', '😂', '😮', '😢', '🙏'];

interface Props {
  message: MobileMessage | null;
  isOwn: boolean;
  onClose: () => void;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onForward: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onStar: () => void;
  onDeleteForMe: () => void;
  onDeleteForEveryone: () => void;
}

export function MessageActionSheet({
  message,
  isOwn,
  onClose,
  onReact,
  onReply,
  onForward,
  onEdit,
  onCopy,
  onStar,
  onDeleteForMe,
  onDeleteForEveryone,
}: Props) {
  const theme = useTheme();
  if (!message) return null;

  const canEdit = isOwn && message.messageType === MessageType.TEXT && !message.isDeletedForEveryone;

  return (
    <Modal visible={Boolean(message)} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: theme.overlay }]} onPress={onClose}>
        <View style={[styles.sheet, { backgroundColor: theme.surfaceElevated }]}>
          <View style={[styles.emojiRow, { borderBottomColor: theme.divider }]}>
            {QUICK_EMOJIS.map((emoji) => (
              <TouchableOpacity
                key={emoji}
                onPress={() => {
                  onReact(emoji);
                  onClose();
                }}
                style={styles.emojiBtn}
              >
                <Text style={styles.emojiText}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <ActionRow icon="arrow-undo-outline" label="Reply" onPress={() => { onReply(); onClose(); }} />
          <ActionRow icon="arrow-redo-outline" label="Forward" onPress={() => { onForward(); onClose(); }} />
          {canEdit && (
            <ActionRow icon="create-outline" label="Edit" onPress={() => { onEdit(); onClose(); }} />
          )}
          <ActionRow
            icon={message.isStarred ? 'star' : 'star-outline'}
            label={message.isStarred ? 'Unstar' : 'Star'}
            onPress={() => { onStar(); onClose(); }}
          />
          <ActionRow icon="copy-outline" label="Copy" onPress={() => { onCopy(); onClose(); }} />
          <ActionRow
            icon="trash-outline"
            label="Delete for me"
            danger
            onPress={() => { onDeleteForMe(); onClose(); }}
          />
          {isOwn && !message.isDeletedForEveryone && (
            <ActionRow
              icon="trash"
              label="Delete for everyone"
              danger
              onPress={() => { onDeleteForEveryone(); onClose(); }}
            />
          )}
        </View>
      </Pressable>
    </Modal>
  );
}

function ActionRow({
  icon,
  label,
  onPress,
  danger,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const theme = useTheme();
  const color = danger ? theme.danger : theme.text;
  return (
    <TouchableOpacity style={styles.actionRow} onPress={onPress}>
      <Ionicons name={icon} size={20} color={color} />
      <Text style={[styles.actionLabel, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 26,
    paddingTop: 10,
  },
  emojiRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 6,
  },
  emojiBtn: { padding: 6 },
  emojiText: { fontSize: 26 },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingVertical: 14,
    gap: 16,
  },
  actionLabel: { fontSize: 16, fontWeight: '500' },
});

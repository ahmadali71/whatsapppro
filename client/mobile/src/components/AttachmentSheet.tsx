import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/colors';

interface Props {
  visible: boolean;
  onClose: () => void;
  onPickCamera: () => void;
  onPickGallery: () => void;
  onPickDocument: () => void;
  onPickLocation: () => void;
  onPickContact: () => void;
  onCreatePoll: (question: string, options: string[]) => void;
}

export function AttachmentSheet({
  visible,
  onClose,
  onPickCamera,
  onPickGallery,
  onPickDocument,
  onPickLocation,
  onPickContact,
  onCreatePoll,
}: Props) {
  const theme = useTheme();
  const [pollOpen, setPollOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);

  const handleSubmitPoll = () => {
    const cleanOpts = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim() || cleanOpts.length < 2) return;
    onCreatePoll(question.trim(), cleanOpts);
    setQuestion('');
    setOptions(['', '']);
    setPollOpen(false);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: theme.overlay }]} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: theme.surfaceElevated }]}>
          {!pollOpen ? (
            <View style={styles.grid}>
              <GridItem icon="camera" color="#EC4899" label="Camera" onPress={() => { onClose(); onPickCamera(); }} />
              <GridItem icon="images" color="#8B5CF6" label="Gallery" onPress={() => { onClose(); onPickGallery(); }} />
              <GridItem icon="document-text" color="#6366F1" label="Document" onPress={() => { onClose(); onPickDocument(); }} />
              <GridItem icon="location" color="#10B981" label="Location" onPress={() => { onClose(); onPickLocation(); }} />
              <GridItem icon="person" color="#0EA5E9" label="Contact" onPress={() => { onClose(); onPickContact(); }} />
              <GridItem icon="stats-chart" color="#F59E0B" label="Poll" onPress={() => setPollOpen(true)} />
            </View>
          ) : (
            <View style={styles.pollContainer}>
              <Text style={[styles.pollTitle, { color: theme.text }]}>Create Poll</Text>
              <TextInput
                value={question}
                onChangeText={setQuestion}
                placeholder="Ask a question..."
                placeholderTextColor={theme.textMuted}
                style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.inputBg }]}
              />
              {options.map((opt, idx) => (
                <TextInput
                  key={idx}
                  value={opt}
                  onChangeText={(txt) => {
                    const copy = [...options];
                    copy[idx] = txt;
                    setOptions(copy);
                  }}
                  placeholder={`Option ${idx + 1}`}
                  placeholderTextColor={theme.textMuted}
                  style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.inputBg }]}
                />
              ))}
              {options.length < 5 && (
                <TouchableOpacity onPress={() => setOptions([...options, ''])}>
                  <Text style={{ color: theme.primary, fontWeight: '600', marginBottom: 12 }}>
                    + Add option
                  </Text>
                </TouchableOpacity>
              )}
              <View style={styles.pollActions}>
                <TouchableOpacity onPress={() => setPollOpen(false)} style={styles.cancelBtn}>
                  <Text style={{ color: theme.textSecondary }}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSubmitPoll}
                  style={[styles.submitBtn, { backgroundColor: theme.primary }]}
                >
                  <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>Send Poll</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function GridItem({
  icon,
  color,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <TouchableOpacity style={styles.gridItem} onPress={onPress}>
      <View style={[styles.iconCircle, { backgroundColor: color }]}>
        <Ionicons name={icon} size={24} color="#FFFFFF" />
      </View>
      <Text style={[styles.gridLabel, { color: theme.text }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    rowGap: 20,
  },
  gridItem: { width: '30%', alignItems: 'center', gap: 8 },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridLabel: { fontSize: 13, fontWeight: '500' },
  pollContainer: { gap: 10 },
  pollTitle: { fontSize: 18, fontWeight: '700', marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  pollActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 6 },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 10 },
  submitBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
});

import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/colors';

interface Props {
  onSendVoiceNote: (uri: string, durationSeconds: number) => Promise<void>;
  onCancel?: () => void;
}

export function VoiceRecorderButton({ onSendVoiceNote, onCancel }: Props) {
  const theme = useTheme();
  const [isRecording, setIsRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      recordingRef.current?.stopAndUnloadAsync().catch(() => {});
    };
  }, []);

  const startRecording = async () => {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) return;

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recordingRef.current = recording;
      startTimeRef.current = Date.now();
      setSeconds(0);
      setIsRecording(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

      timerRef.current = setInterval(() => {
        setSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 400);
    } catch {
      setIsRecording(false);
    }
  };

  const stopAndSend = async () => {
    if (!recordingRef.current) return;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const duration = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      setIsRecording(false);
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      if (uri) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        await onSendVoiceNote(uri, duration);
      }
    } catch {
      setIsRecording(false);
    }
  };

  const cancelRecording = async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    try {
      await recordingRef.current?.stopAndUnloadAsync();
    } catch {
      // ignore
    }
    recordingRef.current = null;
    setIsRecording(false);
    onCancel?.();
  };

  if (isRecording) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return (
      <View style={[styles.recordingBar, { backgroundColor: theme.inputBg, borderColor: theme.border }]}>
        <TouchableOpacity onPress={cancelRecording} style={styles.cancelBtn}>
          <Ionicons name="trash-outline" size={20} color={theme.danger} />
        </TouchableOpacity>
        <View style={[styles.dot, { backgroundColor: theme.danger }]} />
        <Text style={[styles.timer, { color: theme.text }]}>
          {`${mins}:${secs < 10 ? '0' : ''}${secs}`}
        </Text>
        <Text style={[styles.hint, { color: theme.textMuted }]}>Recording voice note...</Text>
        <TouchableOpacity
          onPress={stopAndSend}
          style={[styles.sendBtn, { backgroundColor: theme.primary }]}
        >
          <Ionicons name="send" size={18} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <TouchableOpacity
      onPress={startRecording}
      onLongPress={startRecording}
      onPressOut={() => {
        if (isRecording && seconds >= 1) {
          stopAndSend().catch(() => {});
        }
      }}
      style={[styles.micBtn, { backgroundColor: theme.primary }]}
    >
      <Ionicons name="mic" size={22} color="#FFFFFF" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  micBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 8,
    flex: 1,
  },
  cancelBtn: { padding: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  timer: { fontSize: 15, fontWeight: '700', minWidth: 40 },
  hint: { flex: 1, fontSize: 12 },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

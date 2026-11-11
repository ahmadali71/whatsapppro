import React, { useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/authStore';
import { useTheme } from '../../theme/colors';

export function BiometricLockOverlay() {
  const theme = useTheme();
  const { isBiometricLocked, unlockWithBiometrics } = useAuthStore();

  useEffect(() => {
    if (isBiometricLocked) {
      unlockWithBiometrics().catch(() => {});
    }
  }, [isBiometricLocked, unlockWithBiometrics]);

  if (!isBiometricLocked) return null;

  return (
    <View style={[styles.overlay, { backgroundColor: theme.background }]}>
      <View style={[styles.iconBox, { backgroundColor: theme.surface }]}>
        <Ionicons name="finger-print" size={58} color={theme.primary} />
      </View>
      <Text style={[styles.title, { color: theme.text }]}>WhatsApp Pro Locked</Text>
      <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
        Use Face ID or Fingerprint to unlock your chats.
      </Text>
      <TouchableOpacity
        style={[styles.btn, { backgroundColor: theme.primary }]}
        onPress={() => unlockWithBiometrics()}
      >
        <Text style={styles.btnText}>Unlock</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  iconBox: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  subtitle: { fontSize: 14, textAlign: 'center', marginBottom: 28 },
  btn: { paddingHorizontal: 36, paddingVertical: 14, borderRadius: 26 },
  btnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});

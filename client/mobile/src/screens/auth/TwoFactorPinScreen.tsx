import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { RootStackParamList } from '../../types/mobile.types';
import { useAuthStore } from '../../stores/authStore';
import { useTheme } from '../../theme/colors';

type Props = NativeStackScreenProps<RootStackParamList, 'TwoFactorPin'>;

export function TwoFactorPinScreen({ route, navigation }: Props) {
  const mode = route.params?.mode ?? 'verify';
  const theme = useTheme();
  const { verifyTwoFactor, enableTwoFactor, isLoading } = useAuthStore();
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (pin.length !== 6) {
      setError('PIN must be exactly 6 digits.');
      return;
    }
    if (mode === 'setup' && pin !== confirmPin) {
      setError('PINs do not match.');
      return;
    }
    setError(null);
    try {
      if (mode === 'verify') {
        await verifyTwoFactor(pin);
      } else {
        await enableTwoFactor(pin);
        Alert.alert('Enabled', 'Two-step verification PIN is now active.');
        navigation.goBack();
      }
    } catch (err: any) {
      setError(err?.message || 'Invalid PIN');
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.inner}
      >
        <View style={styles.top}>
          <View style={[styles.iconCircle, { backgroundColor: theme.surface }]}>
            <Ionicons name="shield-checkmark" size={44} color={theme.primary} />
          </View>
          <Text style={[styles.title, { color: theme.text }]}>
            {mode === 'verify' ? 'Two-Step Verification' : 'Set Two-Step PIN'}
          </Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            {mode === 'verify'
              ? 'This account is protected by a 6-digit PIN. Enter it to finish signing in.'
              : 'Create a 6-digit PIN that will be asked when registering your number again.'}
          </Text>

          <TextInput
            value={pin}
            onChangeText={(txt) => setPin(txt.replace(/\D/g, '').slice(0, 6))}
            placeholder="••••••"
            placeholderTextColor={theme.textMuted}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
            style={[styles.pinInput, { color: theme.text, borderColor: theme.primary, backgroundColor: theme.surface }]}
          />

          {mode === 'setup' && (
            <TextInput
              value={confirmPin}
              onChangeText={(txt) => setConfirmPin(txt.replace(/\D/g, '').slice(0, 6))}
              placeholder="Confirm 6-digit PIN"
              placeholderTextColor={theme.textMuted}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              style={[
                styles.pinInput,
                { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface, marginTop: 14 },
              ]}
            />
          )}

          {error ? <Text style={[styles.error, { color: theme.danger }]}>{error}</Text> : null}
        </View>

        <TouchableOpacity
          style={[styles.btn, { backgroundColor: theme.primary }]}
          onPress={handleSubmit}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.btnText}>
              {mode === 'verify' ? 'Unlock Account' : 'Save 2FA PIN'}
            </Text>
          )}
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1, justifyContent: 'space-between', padding: 24 },
  top: { alignItems: 'center', marginTop: 40 },
  iconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 10 },
  subtitle: { fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 28 },
  pinInput: {
    width: '80%',
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 14,
    fontSize: 22,
    textAlign: 'center',
    letterSpacing: 8,
  },
  error: { marginTop: 14, fontSize: 13 },
  btn: { borderRadius: 26, paddingVertical: 14, alignItems: 'center', marginBottom: 12 },
  btnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import * as Haptics from 'expo-haptics';
import { RootStackParamList } from '../../types/mobile.types';
import { useAuthStore } from '../../stores/authStore';
import { useTheme } from '../../theme/colors';

type Props = NativeStackScreenProps<RootStackParamList, 'OtpVerify'>;

export function OtpVerifyScreen({ route, navigation }: Props) {
  const { phoneNumber, countryCode } = route.params;
  const theme = useTheme();
  const { verifyOtp, sendOtp, devOtp, isLoading } = useAuthStore();
  const [code, setCode] = useState('');
  const [timer, setTimer] = useState(60);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setTimer((t) => (t > 0 ? t - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const submitCode = async (otp: string) => {
    if (otp.length !== 6) return;
    setError(null);
    try {
      const result = await verifyOtp(phoneNumber, otp);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (result.requiresTwoFactor) {
        navigation.replace('TwoFactorPin', { mode: 'verify', phoneNumber });
      } else if (result.isNewUser) {
        navigation.replace('ProfileSetup', { isOnboarding: true });
      }
      // Otherwise App.tsx switches automatically to MainTabs because isAuthenticated is true
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setError(err?.message || 'Verification failed. Check the 6-digit code.');
    }
  };

  const handleResend = async () => {
    if (timer > 0) return;
    setError(null);
    try {
      await sendOtp(phoneNumber, countryCode);
      setTimer(60);
    } catch (err: any) {
      setError(err?.message || 'Could not resend OTP.');
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.inner}
      >
        <View>
          <Text style={[styles.title, { color: theme.primary }]}>Verifying {phoneNumber}</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            Enter the 6-digit code sent via SMS to your number.
          </Text>

          <TouchableOpacity
            activeOpacity={1}
            onPress={() => inputRef.current?.focus()}
            style={styles.boxesRow}
          >
            {Array.from({ length: 6 }).map((_, idx) => {
              const char = code[idx] || '';
              const isFocused = code.length === idx;
              return (
                <View
                  key={idx}
                  style={[
                    styles.digitBox,
                    {
                      backgroundColor: theme.surface,
                      borderColor: isFocused ? theme.primary : theme.border,
                    },
                  ]}
                >
                  <Text style={[styles.digitText, { color: theme.text }]}>{char}</Text>
                </View>
              );
            })}
          </TouchableOpacity>

          <TextInput
            ref={inputRef}
            value={code}
            onChangeText={(txt) => {
              const digits = txt.replace(/\D/g, '').slice(0, 6);
              setCode(digits);
              if (digits.length === 6) {
                submitCode(digits);
              }
            }}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoFocus
            style={styles.hiddenInput}
          />

          {devOtp ? (
            <View
              style={[
                styles.devBanner,
                { backgroundColor: theme.surface, borderColor: theme.primary },
              ]}
            >
              <View style={styles.devBannerTextWrap}>
                <Text style={[styles.devBannerLabel, { color: theme.textSecondary }]}>
                  Dev Mode OTP (SMS not configured)
                </Text>
                <Text style={[styles.devBannerCode, { color: theme.primary }]}>{devOtp}</Text>
              </View>
              <TouchableOpacity
                style={[styles.fillOtpBtn, { backgroundColor: theme.primary }]}
                onPress={() => {
                  const digits = devOtp.replace(/\D/g, '').slice(0, 6);
                  setCode(digits);
                  if (digits.length === 6) {
                    submitCode(digits);
                  }
                }}
              >
                <Text style={styles.fillOtpText}>Fill OTP</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {error ? <Text style={[styles.error, { color: theme.danger }]}>{error}</Text> : null}

          <TouchableOpacity
            onPress={handleResend}
            disabled={timer > 0 || isLoading}
            style={styles.resendBtn}
          >
            <Text style={{ color: timer > 0 ? theme.textMuted : theme.primary, fontWeight: '600' }}>
              {timer > 0 ? `Resend code in ${timer}s` : 'Resend SMS Code'}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[
            styles.verifyBtn,
            { backgroundColor: code.length === 6 && !isLoading ? theme.primary : theme.textMuted },
          ]}
          disabled={code.length !== 6 || isLoading}
          onPress={() => submitCode(code)}
        >
          {isLoading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.verifyText}>Verify Code</Text>
          )}
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1, justifyContent: 'space-between', padding: 24, paddingTop: 40 },
  title: { fontSize: 21, fontWeight: '700', textAlign: 'center', marginBottom: 10 },
  subtitle: { fontSize: 14, textAlign: 'center', marginBottom: 32 },
  boxesRow: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  digitBox: {
    width: 46,
    height: 56,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digitText: { fontSize: 22, fontWeight: '700' },
  hiddenInput: { position: 'absolute', opacity: 0, width: 1, height: 1 },
  devBanner: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  devBannerTextWrap: { flex: 1 },
  devBannerLabel: { fontSize: 12, fontWeight: '500' },
  devBannerCode: { fontSize: 18, fontWeight: '800', letterSpacing: 2, marginTop: 2 },
  fillOtpBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  fillOtpText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  error: { marginTop: 16, textAlign: 'center', fontSize: 13 },
  resendBtn: { marginTop: 28, alignItems: 'center' },
  verifyBtn: { borderRadius: 26, paddingVertical: 14, alignItems: 'center', marginBottom: 12 },
  verifyText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});

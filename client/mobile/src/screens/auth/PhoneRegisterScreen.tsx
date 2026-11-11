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
import axios from 'axios';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { COUNTRY_CODES, CountryCodeItem, extractErrorMessage, RootStackParamList } from '../../types/mobile.types';
import { getApiBaseUrl, setApiBaseUrl } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { useTheme } from '../../theme/colors';
import { CountryCodePickerModal } from '../../components/CountryCodePickerModal';

type Props = NativeStackScreenProps<RootStackParamList, 'PhoneRegister'>;

export function PhoneRegisterScreen({ navigation }: Props) {
  const theme = useTheme();
  const { startPhoneAuth, isLoading } = useAuthStore();
  const [country, setCountry] = useState<CountryCodeItem>(COUNTRY_CODES[0]);
  const [phoneDigits, setPhoneDigits] = useState('');
  const [pickerVisible, setPickerVisible] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [serverEditorOpen, setServerEditorOpen] = useState(false);
  const [serverUrlInput, setServerUrlInput] = useState(getApiBaseUrl());

  const handleSaveServerUrl = async () => {
    const saved = await setApiBaseUrl(serverUrlInput);
    setServerUrlInput(saved);
    const origin = saved.replace(/\/api(\/v\d+)?$/, '');
    try {
      await axios.get(`${origin}/api/docs`, {
        timeout: 5000,
        validateStatus: (status) => status >= 200 && status < 500,
      });
      setServerEditorOpen(false);
      setValidationError(null);
      Alert.alert('Server Connected', `Successfully reached ${origin}.`);
    } catch (err) {
      setValidationError(
        `Cannot reach ${origin}: ${extractErrorMessage(err)}. Check Wi-Fi IP / firewall or use your public https:// server URL.`,
      );
    }
  };

  const handleContinue = async () => {
    const cleaned = phoneDigits.replace(/\D/g, '');
    if (cleaned.length < 7 || cleaned.length > 14) {
      setValidationError('Please enter a valid phone number (7–14 digits).');
      return;
    }
    setValidationError(null);
    if (serverEditorOpen && serverUrlInput.trim()) {
      await handleSaveServerUrl();
    }
    const e164 = `${country.dialCode}${cleaned}`;
    try {
      await startPhoneAuth(e164, country.code);
      navigation.navigate('OtpVerify', {
        phoneNumber: e164,
        countryCode: country.code,
      });
    } catch (err: any) {
      setValidationError(err?.message || 'Unable to send OTP. Please try again.');
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.inner}
      >
        <View>
          <Text style={[styles.title, { color: theme.primary }]}>Enter your phone number</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            WhatsApp Pro will need to verify your phone number via SMS. Carrier charges may apply.
          </Text>

          <TouchableOpacity
            style={[styles.countrySelector, { borderBottomColor: theme.primary }]}
            onPress={() => setPickerVisible(true)}
          >
            <Text style={styles.flag}>{country.flag}</Text>
            <Text style={[styles.countryName, { color: theme.text }]}>{country.name}</Text>
            <Ionicons name="chevron-down" size={20} color={theme.primary} />
          </TouchableOpacity>

          <View style={styles.phoneRow}>
            <View style={[styles.dialBox, { borderBottomColor: theme.primary }]}>
              <Text style={[styles.dialText, { color: theme.text }]}>{country.dialCode}</Text>
            </View>
            <TextInput
              value={phoneDigits}
              onChangeText={(txt) => {
                setPhoneDigits(txt.replace(/[^\d\s-]/g, ''));
                if (validationError) setValidationError(null);
              }}
              placeholder="Phone number"
              placeholderTextColor={theme.textMuted}
              keyboardType="phone-pad"
              autoFocus
              style={[styles.phoneInput, { color: theme.text, borderBottomColor: theme.primary }]}
            />
          </View>

          {validationError ? (
            <Text style={[styles.errorText, { color: theme.danger }]}>{validationError}</Text>
          ) : null}

          <TouchableOpacity
            style={styles.serverToggle}
            onPress={() => setServerEditorOpen((prev) => !prev)}
          >
            <Text style={[styles.serverToggleText, { color: theme.primary }]}>
              Server: {getApiBaseUrl()} ({serverEditorOpen ? 'Hide' : 'Wi-Fi / Internet URL'})
            </Text>
          </TouchableOpacity>

          {serverEditorOpen ? (
            <View style={[styles.serverBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <TextInput
                value={serverUrlInput}
                onChangeText={setServerUrlInput}
                placeholder="http://192.168.100.62:3001/api/v1"
                placeholderTextColor={theme.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.serverInput, { color: theme.text, borderColor: theme.border }]}
              />
              <TouchableOpacity
                style={[styles.serverSaveBtn, { backgroundColor: theme.primary }]}
                onPress={handleSaveServerUrl}
              >
                <Text style={styles.serverSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        <TouchableOpacity
          style={[
            styles.nextBtn,
            { backgroundColor: isLoading ? theme.textMuted : theme.primary },
          ]}
          disabled={isLoading}
          onPress={handleContinue}
        >
          {isLoading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.nextText}>Next</Text>
          )}
        </TouchableOpacity>
      </KeyboardAvoidingView>

      <CountryCodePickerModal
        visible={pickerVisible}
        selectedCode={country.code}
        onSelect={setCountry}
        onClose={() => setPickerVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1, justifyContent: 'space-between', padding: 24, paddingTop: 40 },
  title: { fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: 12 },
  subtitle: { fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 32 },
  countrySelector: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1.5,
    paddingVertical: 12,
    marginBottom: 20,
    gap: 10,
  },
  flag: { fontSize: 22 },
  countryName: { flex: 1, fontSize: 16, fontWeight: '600' },
  phoneRow: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  dialBox: { borderBottomWidth: 1.5, paddingVertical: 10, minWidth: 68, alignItems: 'center' },
  dialText: { fontSize: 18, fontWeight: '600' },
  phoneInput: { flex: 1, borderBottomWidth: 1.5, paddingVertical: 10, fontSize: 18, letterSpacing: 1 },
  errorText: { marginTop: 12, fontSize: 13, textAlign: 'center' },
  serverToggle: { marginTop: 18, alignItems: 'center' },
  serverToggleText: { fontSize: 12, textDecorationLine: 'underline' },
  serverBox: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  serverInput: { flex: 1, fontSize: 12, borderBottomWidth: 1, paddingVertical: 4 },
  serverSaveBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  serverSaveText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  nextBtn: {
    borderRadius: 26,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  nextText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});

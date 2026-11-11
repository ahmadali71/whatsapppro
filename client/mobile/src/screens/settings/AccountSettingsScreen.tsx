import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import api from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { useTheme } from '../../theme/colors';
import { extractErrorMessage, RootStackParamList } from '../../types/mobile.types';

export function AccountSettingsScreen() {
  const theme = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { user, logout, refreshMe } = useAuthStore();

  const [changeNumModal, setChangeNumModal] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [countryCode, setCountryCode] = useState(user?.countryCode || 'US');
  const [submitting, setSubmitting] = useState(false);

  const handleChangeNumber = async () => {
    if (!/^\+[1-9]\d{6,14}$/.test(newPhone.trim())) {
      Alert.alert('Invalid Phone', 'Enter phone number in E.164 format, e.g. +15551234567.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/users/change-number', {
        new_phone_number: newPhone.trim(),
        new_country_code: countryCode.trim().toUpperCase(),
      });
      await refreshMe();
      setChangeNumModal(false);
      setNewPhone('');
      Alert.alert('Updated', 'Your phone number has been changed.');
    } catch (err) {
      Alert.alert('Failed', extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete My Account',
      'This will permanently delete your account, message history, and group memberships.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete('/users/me');
              await logout();
            } catch (err) {
              Alert.alert('Error', extractErrorMessage(err));
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView>
        <View style={[styles.infoBox, { backgroundColor: theme.surface }]}>
          <Text style={{ color: theme.textSecondary, fontSize: 12 }}>REGISTERED NUMBER</Text>
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700', marginTop: 4 }}>
            {user?.phoneNumber}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.row, { borderBottomColor: theme.divider }]}
          onPress={() => navigation.navigate('TwoFactorPin', { mode: 'setup' })}
        >
          <Ionicons name="shield-checkmark-outline" size={22} color={theme.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowTitle, { color: theme.text }]}>Two-step verification</Text>
            <Text style={{ color: theme.textSecondary, fontSize: 13 }}>
              {user?.twoFactorEnabled ? 'Enabled (tap to update PIN)' : 'Add a 6-digit PIN'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.row, { borderBottomColor: theme.divider }]}
          onPress={() => setChangeNumModal(true)}
        >
          <Ionicons name="phone-portrait-outline" size={22} color={theme.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowTitle, { color: theme.text }]}>Change number</Text>
            <Text style={{ color: theme.textSecondary, fontSize: 13 }}>
              Migrate your account to a new phone number
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.row, { borderBottomColor: theme.divider }]}
          onPress={handleDeleteAccount}
        >
          <Ionicons name="trash-outline" size={22} color={theme.danger} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowTitle, { color: theme.danger }]}>Delete my account</Text>
            <Text style={{ color: theme.textSecondary, fontSize: 13 }}>
              Permanently remove your WhatsApp Pro account
            </Text>
          </View>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={changeNumModal} transparent animationType="fade" onRequestClose={() => setChangeNumModal(false)}>
        <View style={[styles.backdrop, { backgroundColor: theme.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: theme.surfaceElevated }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Change Phone Number</Text>
            <TextInput
              value={newPhone}
              onChangeText={setNewPhone}
              placeholder="New E.164 phone (e.g. +15551234567)"
              placeholderTextColor={theme.textMuted}
              keyboardType="phone-pad"
              style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.inputBg }]}
            />
            <TextInput
              value={countryCode}
              onChangeText={setCountryCode}
              placeholder="Country ISO (e.g. US)"
              placeholderTextColor={theme.textMuted}
              autoCapitalize="characters"
              maxLength={3}
              style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.inputBg }]}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setChangeNumModal(false)} style={styles.cancelBtn}>
                <Text style={{ color: theme.textSecondary }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleChangeNumber}
                disabled={submitting}
                style={[styles.saveBtn, { backgroundColor: theme.primary }]}
              >
                {submitting ? <ActivityIndicator color="#FFF" /> : <Text style={{ color: '#FFF', fontWeight: '700' }}>Update</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  infoBox: { margin: 16, padding: 16, borderRadius: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowTitle: { fontSize: 16, fontWeight: '600', marginBottom: 2 },
  backdrop: { flex: 1, justifyContent: 'center', padding: 22 },
  modalCard: { borderRadius: 16, padding: 20, gap: 12 },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 4 },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 10 },
  saveBtn: { paddingHorizontal: 22, paddingVertical: 10, borderRadius: 10 },
});

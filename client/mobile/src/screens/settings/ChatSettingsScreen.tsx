import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { FontSize, ThemePreference } from '@whatsapp-pro/shared-types';
import api from '../../services/api';
import { useThemeStore } from '../../stores/themeStore';
import { useTheme } from '../../theme/colors';
import { extractErrorMessage } from '../../types/mobile.types';

const WALLPAPER_SWATCHES: Array<{ label: string; value: string | null }> = [
  { label: 'Default', value: null },
  { label: 'Sand', value: '#EFEAE2' },
  { label: 'Mint', value: '#DCFCE7' },
  { label: 'Slate', value: '#1E293B' },
  { label: 'Midnight', value: '#0F172A' },
];

export function ChatSettingsScreen() {
  const theme = useTheme();
  const {
    themePreference,
    fontSize,
    wallpaper,
    enterToSend,
    mediaAutoDownloadWifi,
    mediaAutoDownloadCellular,
    setThemePreference,
    setFontSize,
    setWallpaper,
    updateChatSettings,
  } = useThemeStore();

  const [backingUp, setBackingUp] = useState(false);

  const handleBackup = async () => {
    setBackingUp(true);
    try {
      await api.post('/settings/backup');
      Alert.alert('Backup Complete', 'Your chat metadata backup has been saved.');
    } catch (err) {
      Alert.alert('Backup Failed', extractErrorMessage(err));
    } finally {
      setBackingUp(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView>
        <Text style={[styles.section, { color: theme.primary }]}>Appearance</Text>
        <View style={styles.chipsWrap}>
          {([ThemePreference.SYSTEM, ThemePreference.LIGHT, ThemePreference.DARK] as ThemePreference[]).map(
            (pref) => (
              <TouchableOpacity
                key={pref}
                onPress={() => setThemePreference(pref)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: themePreference === pref ? theme.primary : theme.surface,
                    borderColor: theme.border,
                  },
                ]}
              >
                <Text style={{ color: themePreference === pref ? '#FFF' : theme.text, fontWeight: '600' }}>
                  {pref}
                </Text>
              </TouchableOpacity>
            ),
          )}
        </View>

        <Text style={[styles.section, { color: theme.primary }]}>Font Size</Text>
        <View style={styles.chipsWrap}>
          {([FontSize.SMALL, FontSize.MEDIUM, FontSize.LARGE] as FontSize[]).map((sz) => (
            <TouchableOpacity
              key={sz}
              onPress={() => setFontSize(sz)}
              style={[
                styles.chip,
                {
                  backgroundColor: fontSize === sz ? theme.primary : theme.surface,
                  borderColor: theme.border,
                },
              ]}
            >
              <Text style={{ color: fontSize === sz ? '#FFF' : theme.text, fontWeight: '600' }}>
                {sz}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.section, { color: theme.primary }]}>Chat Wallpaper</Text>
        <View style={styles.chipsWrap}>
          {WALLPAPER_SWATCHES.map((sw) => {
            const active = wallpaper === sw.value;
            return (
              <TouchableOpacity
                key={sw.label}
                onPress={() => setWallpaper(sw.value)}
                style={[
                  styles.swatch,
                  {
                    backgroundColor: sw.value || theme.surface,
                    borderColor: active ? theme.primary : theme.border,
                    borderWidth: active ? 2.5 : 1,
                  },
                ]}
              >
                <Text style={{ color: sw.value === '#1E293B' || sw.value === '#0F172A' ? '#FFF' : '#111', fontSize: 12, fontWeight: '600' }}>
                  {sw.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={[styles.switchRow, { borderBottomColor: theme.divider }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.label, { color: theme.text }]}>Enter is send</Text>
            <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
              Enter key sends your message
            </Text>
          </View>
          <Switch
            value={enterToSend}
            onValueChange={(val) => updateChatSettings({ enterToSend: val })}
            trackColor={{ true: theme.primary, false: theme.border }}
          />
        </View>

        <View style={[styles.switchRow, { borderBottomColor: theme.divider }]}>
          <Text style={[styles.label, { color: theme.text, flex: 1 }]}>Auto-download on Wi-Fi</Text>
          <Switch
            value={mediaAutoDownloadWifi}
            onValueChange={(val) => updateChatSettings({ mediaAutoDownloadWifi: val })}
            trackColor={{ true: theme.primary, false: theme.border }}
          />
        </View>

        <View style={[styles.switchRow, { borderBottomColor: theme.divider }]}>
          <Text style={[styles.label, { color: theme.text, flex: 1 }]}>Auto-download on Cellular</Text>
          <Switch
            value={mediaAutoDownloadCellular}
            onValueChange={(val) => updateChatSettings({ mediaAutoDownloadCellular: val })}
            trackColor={{ true: theme.primary, false: theme.border }}
          />
        </View>

        <TouchableOpacity
          style={[styles.backupBtn, { backgroundColor: theme.primary }]}
          onPress={handleBackup}
          disabled={backingUp}
        >
          {backingUp ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 15 }}>Back Up Chats Now</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  section: { fontSize: 13, fontWeight: '700', paddingHorizontal: 16, paddingTop: 18, paddingBottom: 8 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 10 },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 18, borderWidth: 1 },
  swatch: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: { fontSize: 16, fontWeight: '600' },
  backupBtn: {
    margin: 20,
    paddingVertical: 14,
    borderRadius: 26,
    alignItems: 'center',
  },
});

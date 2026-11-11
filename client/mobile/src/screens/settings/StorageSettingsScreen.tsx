import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../../services/api';
import { useTheme } from '../../theme/colors';
import { extractErrorMessage, unwrapApiData } from '../../types/mobile.types';

interface StorageEntry {
  conversationId: string;
  title?: string;
  totalBytes: number;
  mediaCount?: number;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx += 1;
  }
  return `${val.toFixed(1)} ${units[idx]}`;
}

export function StorageSettingsScreen() {
  const theme = useTheme();
  const [entries, setEntries] = useState<StorageEntry[]>([]);
  const [totalBytes, setTotalBytes] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadStorage = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/settings/storage');
      const data = unwrapApiData<{
        totalBytes?: number;
        totalSize?: number;
        conversations?: StorageEntry[];
        items?: StorageEntry[];
      } | StorageEntry[]>(res.data);

      if (Array.isArray(data)) {
        setEntries(data);
        setTotalBytes(data.reduce((acc, e) => acc + (e.totalBytes || 0), 0));
      } else {
        const list = data?.conversations ?? data?.items ?? [];
        setEntries(list);
        setTotalBytes(
          data?.totalBytes ?? data?.totalSize ?? list.reduce((acc, e) => acc + (e.totalBytes || 0), 0),
        );
      }
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStorage();
  }, [loadStorage]);

  const handleClearChat = (entry: StorageEntry) => {
    Alert.alert(
      'Clear Chat Media',
      `Remove cached media for ${entry.title || 'this chat'} (${formatBytes(entry.totalBytes)})?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/settings/storage/${entry.conversationId}`);
              await loadStorage();
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
      <FlatList
        data={entries}
        keyExtractor={(item) => item.conversationId}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={loadStorage} tintColor={theme.primary} />
        }
        ListHeaderComponent={
          <View style={[styles.summaryCard, { backgroundColor: theme.surface }]}>
            <Ionicons name="pie-chart" size={32} color={theme.primary} />
            <View>
              <Text style={{ color: theme.textSecondary, fontSize: 12 }}>TOTAL MEDIA STORAGE</Text>
              <Text style={{ color: theme.text, fontSize: 22, fontWeight: '800' }}>
                {formatBytes(totalBytes)}
              </Text>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.row, { borderBottomColor: theme.divider }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: theme.text }]}>
                {item.title || `Chat ${item.conversationId.slice(0, 8)}`}
              </Text>
              <Text style={{ color: theme.textSecondary, fontSize: 13 }}>
                {formatBytes(item.totalBytes)}
                {item.mediaCount ? ` • ${item.mediaCount} files` : ''}
              </Text>
            </View>
            <TouchableOpacity onPress={() => handleClearChat(item)} style={styles.clearBtn}>
              <Text style={{ color: theme.danger, fontWeight: '700' }}>Clear</Text>
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={{ margin: 32 }} color={theme.primary} />
          ) : (
            <Text style={{ color: theme.textMuted, padding: 32, textAlign: 'center' }}>
              No chat media stored yet.
            </Text>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 16,
    padding: 18,
    borderRadius: 14,
    gap: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  clearBtn: { paddingHorizontal: 12, paddingVertical: 6 },
});

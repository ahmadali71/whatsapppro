import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Contacts from 'expo-contacts';
import { Ionicons } from '@expo/vector-icons';
import { ConversationType, User } from '@whatsapp-pro/shared-types';
import api, { getSocketBaseUrl } from '../../services/api';
import socketService from '../../services/socket';
import { useChatStore } from '../../stores/chatStore';
import { useAuthStore } from '../../stores/authStore';
import { useTheme } from '../../theme/colors';
import {
  COUNTRY_CODES,
  CountryCodeItem,
  extractErrorMessage,
  MobileConversation,
  normalizeUser,
  RootStackParamList,
  unwrapApiData,
} from '../../types/mobile.types';
import { Avatar } from '../../components/Avatar';
import { CountryCodePickerModal } from '../../components/CountryCodePickerModal';

type FilterTab = 'ALL' | 'UNREAD' | 'GROUPS' | 'ARCHIVED';

/** Normalizes raw phone input into valid E.164 format or returns null if invalid. */
function normalizePhoneToE164(raw: string, fallbackDialCode: string): string | null {
  let cleaned = raw.replace(/[^\d+]/g, '');
  if (!cleaned) return null;
  if (cleaned.startsWith('00')) {
    cleaned = `+${cleaned.slice(2)}`;
  } else if (!cleaned.startsWith('+')) {
    const digits = cleaned.replace(/^0+/, '');
    if (!digits) return null;
    const prefix = fallbackDialCode.startsWith('+') ? fallbackDialCode : `+${fallbackDialCode}`;
    cleaned = `${prefix}${digits}`;
  }
  return /^\+[1-9]\d{6,14}$/.test(cleaned) ? cleaned : null;
}

/** Extracts normalized peer user from either a Contact wrapper or raw User object. */
function extractContactUser(entry: Record<string, any>): User {
  const inner = (entry.contactUser ?? entry.users_contacts_contact_idTousers ?? entry) as Record<
    string,
    unknown
  >;
  const u = normalizeUser(inner);
  const nickname = typeof entry.nickname === 'string' ? entry.nickname.trim() : '';
  return nickname ? { ...u, displayName: nickname } : u;
}

export function ChatsListScreen() {
  const theme = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { user } = useAuthStore();
  const {
    conversations,
    onlineUsers,
    typingUsers,
    isLoadingChats,
    error,
    fetchConversations,
    createDirectConversation,
    archiveConversation,
    muteConversation,
  } = useChatStore();

  const [filter, setFilter] = useState<FilterTab>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [globalResults, setGlobalResults] = useState<User[]>([]);
  const [newChatModal, setNewChatModal] = useState(false);
  const [userQuery, setUserQuery] = useState('');
  const [searchedUsers, setSearchedUsers] = useState<User[]>([]);
  const [syncedContacts, setSyncedContacts] = useState<User[]>([]);
  const [syncingContacts, setSyncingContacts] = useState(false);
  const [newGroupMode, setNewGroupMode] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [addContactMode, setAddContactMode] = useState(false);
  const [newContactName, setNewContactName] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');
  const [newContactCountry, setNewContactCountry] = useState<CountryCodeItem>(
    () => COUNTRY_CODES.find((c) => c.code === user?.countryCode) ?? COUNTRY_CODES[0],
  );
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [socketConnected, setSocketConnected] = useState(socketService.isConnected());

  useEffect(() => {
    setSocketConnected(socketService.isConnected());
    const unsubConn = socketService.on('socket:connected', () => setSocketConnected(true));
    const unsubDisc = socketService.on('socket:disconnected', () => setSocketConnected(false));
    return () => {
      unsubConn();
      unsubDisc();
    };
  }, []);

  useEffect(() => {
    fetchConversations().catch(() => {});
    const poll = setInterval(() => {
      fetchConversations(true, true).catch(() => {});
    }, 6000);
    return () => clearInterval(poll);
  }, [fetchConversations]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setGlobalResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await api.get('/search', { params: { q, type: 'contacts' } });
        const data = unwrapApiData<{ contacts?: Record<string, unknown>[] } | Record<string, unknown>[]>(
          res.data,
        );
        const list = Array.isArray(data) ? data : data?.contacts ?? [];
        setGlobalResults(list.map(normalizeUser));
      } catch {
        setGlobalResults([]);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const loadContactsFromServer = useCallback(async () => {
    try {
      const res = await api.get('/users/contacts');
      const data = unwrapApiData<Record<string, any>[]>(res.data) ?? [];
      const users = data.map(extractContactUser);
      setSyncedContacts(users.filter((u) => u.id && u.id !== user?.id));
    } catch {
      // ignore
    }
  }, [user?.id]);

  const openNewChatModal = () => {
    setNewChatModal(true);
    setNewGroupMode(false);
    setAddContactMode(false);
    setSelectedMemberIds([]);
    loadContactsFromServer();
  };

  const handleAddNewContact = async () => {
    const e164 = normalizePhoneToE164(newContactPhone.trim(), newContactCountry.dialCode);
    if (!e164) {
      Alert.alert(
        'Invalid Phone Number',
        'Enter a valid phone number (7–14 digits, with country code or + prefix).',
      );
      return;
    }
    setSavingContact(true);
    try {
      const res = await api.post('/users/contacts/sync', {
        contacts: [
          {
            phone_number: e164,
            ...(newContactName.trim() ? { nickname: newContactName.trim().slice(0, 100) } : {}),
          },
        ],
      });
      const matched = unwrapApiData<Record<string, any>[]>(res.data) ?? [];
      let target = matched.map(extractContactUser).find((u) => u.id && u.id !== user?.id);

      if (!target) {
        const searchRes = await api
          .get('/users/search', { params: { q: e164, type: 'phone' } })
          .catch(() => null);
        const searched = searchRes
          ? unwrapApiData<Record<string, any>[]>(searchRes.data) ?? []
          : [];
        target = searched.map(normalizeUser).find((u) => u.id && u.id !== user?.id);
      }

      if (!target) {
        Alert.alert(
          'Not on WhatsApp Pro Yet',
          `No registered account found for ${e164}. Ask them to sign up with this number first.`,
        );
        return;
      }

      await loadContactsFromServer();
      setAddContactMode(false);
      setNewContactName('');
      setNewContactPhone('');
      await startDirectChat(target);
    } catch (err) {
      Alert.alert('Could Not Add Contact', extractErrorMessage(err));
    } finally {
      setSavingContact(false);
    }
  };

  const handleSyncPhoneContacts = () => {
    Alert.alert(
      'Sync Device Contacts',
      'WhatsApp Pro uses your phone contacts to find friends who already have an account.',
      [
        { text: 'Not Now', style: 'cancel' },
        {
          text: 'Allow & Sync',
          onPress: async () => {
            setSyncingContacts(true);
            try {
              const { status } = await Contacts.requestPermissionsAsync();
              if (status !== 'granted') {
                Alert.alert('Permission Denied', 'Enable Contacts permission in settings to sync.');
                return;
              }
              const { data } = await Contacts.getContactsAsync({
                fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
              });
              const defaultDial =
                COUNTRY_CODES.find((c) => c.code === user?.countryCode)?.dialCode || '+1';
              const byPhone = new Map<string, string | undefined>();
              for (const contact of data) {
                const nickname = contact.name?.trim().slice(0, 100) || undefined;
                for (const p of contact.phoneNumbers ?? []) {
                  const e164 = normalizePhoneToE164(p.number || '', defaultDial);
                  if (e164 && !byPhone.has(e164)) {
                    byPhone.set(e164, nickname);
                  }
                }
              }

              if (byPhone.size === 0) {
                Alert.alert('No Contacts Found', 'No valid phone numbers found in your address book.');
                return;
              }
              const payload = Array.from(byPhone.entries())
                .slice(0, 500)
                .map(([phone_number, nickname]) => ({
                  phone_number,
                  ...(nickname ? { nickname } : {}),
                }));
              const res = await api.post('/users/contacts/sync', { contacts: payload });
              const matched = unwrapApiData<Record<string, any>[]>(res.data) ?? [];
              const normalized = matched
                .map(extractContactUser)
                .filter((u) => u.id && u.id !== user?.id);
              setSyncedContacts(normalized);
              Alert.alert('Contacts Synced', `Found ${normalized.length} contacts on WhatsApp Pro.`);
            } catch (err) {
              Alert.alert('Sync Failed', extractErrorMessage(err));
            } finally {
              setSyncingContacts(false);
            }
          },
        },
      ],
    );
  };

  useEffect(() => {
    if (!newChatModal) return;
    const q = userQuery.trim();
    if (q.length < 2) {
      setSearchedUsers([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const type = q.startsWith('+') || /^\d+$/.test(q) ? 'phone' : 'username';
        const res = await api.get('/users/search', { params: { q, type } });
        const list = unwrapApiData<Record<string, unknown>[]>(res.data) ?? [];
        setSearchedUsers(list.map(normalizeUser).filter((u) => u.id !== user?.id));
      } catch {
        setSearchedUsers([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [newChatModal, userQuery, user?.id]);

  const startDirectChat = async (targetUser: User) => {
    try {
      const conv = await createDirectConversation(targetUser.id);
      setNewChatModal(false);
      navigation.navigate('ChatRoom', {
        conversationId: conv.id,
        title: targetUser.displayName || targetUser.phoneNumber,
        avatarUrl: targetUser.avatarUrl,
        peerUserId: targetUser.id,
      });
    } catch (err) {
      Alert.alert('Error', extractErrorMessage(err, 'Could not open chat'));
    }
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim() || selectedMemberIds.length === 0) {
      Alert.alert('Missing Info', 'Enter a group name and select at least one member.');
      return;
    }
    try {
      const res = await api.post('/groups', {
        name: groupName.trim(),
        memberIds: selectedMemberIds,
      });
      const created = unwrapApiData<Record<string, any>>(res.data);
      setNewChatModal(false);
      setGroupName('');
      setSelectedMemberIds([]);
      await fetchConversations();
      const targetConvId =
        created?.conversationId ?? created?.conversation?.id ?? created?.conversations?.[0]?.id;
      if (targetConvId) {
        navigation.navigate('ChatRoom', {
          conversationId: targetConvId,
          title: groupName.trim(),
        });
      }
    } catch (err) {
      Alert.alert('Failed', extractErrorMessage(err, 'Could not create group'));
    }
  };

  const filteredConversations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return conversations.filter((c) => {
      if (filter === 'ARCHIVED') {
        if (!c.isArchived) return false;
      } else if (c.isArchived) {
        return false;
      }
      if (filter === 'UNREAD' && c.unreadCount <= 0) return false;
      if (filter === 'GROUPS' && c.type === ConversationType.DIRECT) return false;

      if (!q) return true;
      return (
        (c.title || '').toLowerCase().includes(q) ||
        (c.lastMessage?.decryptedContent || c.lastMessage?.content || '').toLowerCase().includes(q)
      );
    });
  }, [conversations, filter, searchQuery]);

  const handleConversationLongPress = (conv: MobileConversation) => {
    Alert.alert(conv.title || 'Chat Options', undefined, [
      {
        text: conv.isArchived ? 'Unarchive Chat' : 'Archive Chat',
        onPress: () => archiveConversation(conv.id, !conv.isArchived).catch(() => {}),
      },
      {
        text: conv.isMuted ? 'Unmute Notifications' : 'Mute Notifications',
        onPress: () => muteConversation(conv.id, !conv.isMuted).catch(() => {}),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const renderConversation = ({ item }: { item: MobileConversation }) => {
    const isPeerOnline = item.peerUser?.id ? Boolean(onlineUsers[item.peerUser.id]) : false;
    const isTyping = (typingUsers[item.id] ?? []).length > 0;
    const preview = isTyping
      ? 'typing...'
      : item.lastMessage?.isDeletedForEveryone
        ? 'This message was deleted'
        : item.lastMessage?.decryptedContent ||
          item.lastMessage?.content ||
          (item.lastMessage?.messageType ? `[${item.lastMessage.messageType}]` : 'Tap to start chatting');

    const timeLabel = item.lastMessage?.createdAt
      ? new Date(item.lastMessage.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';

    return (
      <TouchableOpacity
        style={[styles.chatRow, { borderBottomColor: theme.divider }]}
        onPress={() =>
          navigation.navigate('ChatRoom', {
            conversationId: item.id,
            title: item.title,
            avatarUrl: item.avatarUrl,
            peerUserId: item.peerUser?.id,
          })
        }
        onLongPress={() => handleConversationLongPress(item)}
      >
        <Avatar
          uri={item.avatarUrl}
          name={item.title}
          size={52}
          isOnline={isPeerOnline}
          isGroup={item.type !== ConversationType.DIRECT}
        />
        <View style={styles.chatInfo}>
          <View style={styles.chatTopRow}>
            <Text numberOfLines={1} style={[styles.chatTitle, { color: theme.text }]}>
              {item.title}
            </Text>
            <Text
              style={[
                styles.chatTime,
                { color: item.unreadCount > 0 ? theme.primary : theme.textMuted },
              ]}
            >
              {timeLabel}
            </Text>
          </View>
          <View style={styles.chatBottomRow}>
            <Text
              numberOfLines={1}
              style={[
                styles.chatPreview,
                { color: isTyping ? theme.primary : theme.textSecondary },
              ]}
            >
              {preview}
            </Text>
            <View style={styles.badges}>
              {item.isMuted && (
                <Ionicons name="volume-mute" size={16} color={theme.textMuted} />
              )}
              {item.unreadCount > 0 && (
                <View style={[styles.unreadBadge, { backgroundColor: theme.badgeBg }]}>
                  <Text style={[styles.unreadText, { color: theme.badgeText }]}>
                    {item.unreadCount > 99 ? '99+' : item.unreadCount}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const discoveryUsers = userQuery.trim().length >= 2 ? searchedUsers : syncedContacts;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Search bar */}
      <View style={[styles.searchWrap, { backgroundColor: theme.surface }]}>
        <Ionicons name="search" size={18} color={theme.textMuted} />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search chats, contacts, or messages..."
          placeholderTextColor={theme.textMuted}
          style={[styles.searchInput, { color: theme.text }]}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={18} color={theme.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Filter chips */}
      <View style={styles.chipsRow}>
        {(['ALL', 'UNREAD', 'GROUPS', 'ARCHIVED'] as FilterTab[]).map((tab) => {
          const active = filter === tab;
          return (
            <TouchableOpacity
              key={tab}
              onPress={() => setFilter(tab)}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? theme.primary : theme.surface,
                  borderColor: active ? theme.primary : theme.border,
                },
              ]}
            >
              <Text
                style={{
                  color: active ? '#FFFFFF' : theme.textSecondary,
                  fontSize: 13,
                  fontWeight: '600',
                }}
              >
                {tab === 'ALL'
                  ? 'All'
                  : tab === 'UNREAD'
                    ? 'Unread'
                    : tab === 'GROUPS'
                      ? 'Groups'
                      : 'Archived'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {!socketConnected ? (
        <TouchableOpacity
          onPress={() => (navigation as any).navigate('Settings')}
          style={[styles.offlineBanner, { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' }]}
        >
          <Ionicons name="cloud-offline-outline" size={16} color="#92400E" />
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: '#92400E', fontWeight: '600' }}>
            Offline ({getSocketBaseUrl()}) — Tap to set Wi-Fi / Internet Server URL
          </Text>
          <Ionicons name="chevron-forward" size={15} color="#92400E" />
        </TouchableOpacity>
      ) : null}

      {error && conversations.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={44} color={theme.textMuted} />
          <Text style={[styles.emptyTitle, { color: theme.text }]}>{error}</Text>
          <TouchableOpacity
            onPress={() => fetchConversations()}
            style={[styles.retryBtn, { backgroundColor: theme.primary }]}
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filteredConversations}
          keyExtractor={(item) => item.id}
          renderItem={renderConversation}
          refreshControl={
            <RefreshControl
              refreshing={isLoadingChats}
              onRefresh={() => fetchConversations(true)}
              tintColor={theme.primary}
            />
          }
          ListFooterComponent={
            globalResults.length > 0 ? (
              <View style={styles.globalSection}>
                <Text style={[styles.sectionHeader, { color: theme.textSecondary }]}>
                  PEOPLE ON WHATSAPP PRO
                </Text>
                {globalResults.map((u) => (
                  <TouchableOpacity
                    key={u.id}
                    style={[styles.chatRow, { borderBottomColor: theme.divider }]}
                    onPress={() => startDirectChat(u)}
                  >
                    <Avatar uri={u.avatarUrl} name={u.displayName} size={44} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.chatTitle, { color: theme.text }]}>{u.displayName}</Text>
                      <Text style={{ color: theme.textSecondary, fontSize: 13 }}>
                        {u.username ? `@${u.username}` : u.phoneNumber}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null
          }
          ListEmptyComponent={
            isLoadingChats ? (
              <View style={styles.center}>
                <ActivityIndicator size="large" color={theme.primary} />
              </View>
            ) : (
              <View style={styles.center}>
                <Ionicons name="chatbubble-ellipses-outline" size={52} color={theme.textMuted} />
                <Text style={[styles.emptyTitle, { color: theme.text }]}>No conversations yet</Text>
                <Text style={{ color: theme.textSecondary, textAlign: 'center' }}>
                  Tap the button below to find contacts or start a new group chat.
                </Text>
              </View>
            )
          }
        />
      )}

      {/* Floating Action Button */}
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: theme.primary }]}
        onPress={openNewChatModal}
      >
        <Ionicons name="chatbubble-ellipses" size={24} color="#FFFFFF" />
      </TouchableOpacity>

      {/* New Chat / Contact Discovery / Group Modal */}
      <Modal visible={newChatModal} animationType="slide" onRequestClose={() => setNewChatModal(false)}>
        <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
          <View style={[styles.modalHeader, { backgroundColor: theme.headerBg }]}>
            <TouchableOpacity onPress={() => setNewChatModal(false)}>
              <Ionicons name="arrow-back" size={24} color={theme.headerText} />
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: theme.headerText }]}>
              {newGroupMode ? 'New Group' : 'Select Contact'}
            </Text>
          </View>

          <View style={styles.modalActions}>
            <TouchableOpacity
              style={[
                styles.actionPill,
                { backgroundColor: addContactMode ? theme.primary : theme.surface },
              ]}
              onPress={() => {
                setAddContactMode((v) => !v);
                setNewGroupMode(false);
              }}
            >
              <Ionicons
                name="person-add"
                size={17}
                color={addContactMode ? '#FFFFFF' : theme.primary}
              />
              <Text
                style={{
                  color: addContactMode ? '#FFFFFF' : theme.text,
                  fontWeight: '600',
                  fontSize: 13,
                }}
              >
                New Contact
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.actionPill,
                { backgroundColor: newGroupMode ? theme.primary : theme.surface },
              ]}
              onPress={() => {
                setNewGroupMode((v) => !v);
                setAddContactMode(false);
              }}
            >
              <Ionicons
                name="people"
                size={17}
                color={newGroupMode ? '#FFFFFF' : theme.primary}
              />
              <Text
                style={{
                  color: newGroupMode ? '#FFFFFF' : theme.text,
                  fontWeight: '600',
                  fontSize: 13,
                }}
              >
                {newGroupMode ? 'Direct Chat' : 'New Group'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionPill, { backgroundColor: theme.surface }]}
              onPress={handleSyncPhoneContacts}
              disabled={syncingContacts}
            >
              <Ionicons name="sync" size={17} color={theme.primary} />
              <Text style={{ color: theme.text, fontWeight: '600', fontSize: 13 }}>
                {syncingContacts ? 'Syncing...' : 'Sync'}
              </Text>
            </TouchableOpacity>
          </View>

          {addContactMode && (
            <View
              style={[
                styles.addContactCard,
                { backgroundColor: theme.surface, borderColor: theme.border },
              ]}
            >
              <Text style={{ color: theme.text, fontWeight: '700', fontSize: 15 }}>
                Add New Contact
              </Text>
              <TextInput
                value={newContactName}
                onChangeText={setNewContactName}
                placeholder="Name (optional)"
                placeholderTextColor={theme.textMuted}
                style={[
                  styles.groupInput,
                  { color: theme.text, borderColor: theme.border, backgroundColor: theme.background },
                ]}
              />
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <TouchableOpacity
                  onPress={() => setCountryPickerOpen(true)}
                  style={[
                    styles.countryBtn,
                    { borderColor: theme.border, backgroundColor: theme.background },
                  ]}
                >
                  <Text style={{ color: theme.text, fontWeight: '600' }}>
                    {newContactCountry.flag} {newContactCountry.dialCode}
                  </Text>
                </TouchableOpacity>
                <TextInput
                  value={newContactPhone}
                  onChangeText={setNewContactPhone}
                  placeholder="Phone number (e.g. 5551234567)"
                  placeholderTextColor={theme.textMuted}
                  keyboardType="phone-pad"
                  style={[
                    styles.groupInput,
                    {
                      flex: 1,
                      color: theme.text,
                      borderColor: theme.border,
                      backgroundColor: theme.background,
                    },
                  ]}
                />
              </View>
              <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
                <TouchableOpacity
                  onPress={() => setAddContactMode(false)}
                  style={[styles.smallBtn, { borderColor: theme.border, borderWidth: 1 }]}
                >
                  <Text style={{ color: theme.textSecondary, fontWeight: '600' }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleAddNewContact}
                  disabled={savingContact}
                  style={[styles.smallBtn, { backgroundColor: theme.primary }]}
                >
                  {savingContact ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>Save & Chat</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {newGroupMode && (
            <View style={{ paddingHorizontal: 14, paddingBottom: 10, gap: 8 }}>
              <TextInput
                value={groupName}
                onChangeText={setGroupName}
                placeholder="Group subject name..."
                placeholderTextColor={theme.textMuted}
                style={[styles.groupInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
              />
            </View>
          )}

          <View style={[styles.searchWrap, { backgroundColor: theme.surface }]}>
            <Ionicons name="search" size={18} color={theme.textMuted} />
            <TextInput
              value={userQuery}
              onChangeText={setUserQuery}
              placeholder="Search by phone or @username..."
              placeholderTextColor={theme.textMuted}
              autoCapitalize="none"
              style={[styles.searchInput, { color: theme.text }]}
            />
          </View>

          <FlatList
            data={discoveryUsers}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const selected = selectedMemberIds.includes(item.id);
              return (
                <TouchableOpacity
                  style={[styles.chatRow, { borderBottomColor: theme.divider }]}
                  onPress={() => {
                    if (newGroupMode) {
                      setSelectedMemberIds((prev) =>
                        prev.includes(item.id)
                          ? prev.filter((id) => id !== item.id)
                          : [...prev, item.id],
                      );
                    } else {
                      startDirectChat(item);
                    }
                  }}
                >
                  <Avatar uri={item.avatarUrl} name={item.displayName} size={46} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.chatTitle, { color: theme.text }]}>{item.displayName}</Text>
                    <Text style={{ color: theme.textSecondary, fontSize: 13 }}>
                      {item.about || item.phoneNumber}
                    </Text>
                  </View>
                  {newGroupMode && (
                    <Ionicons
                      name={selected ? 'checkbox' : 'square-outline'}
                      size={22}
                      color={selected ? theme.primary : theme.textMuted}
                    />
                  )}
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <View style={styles.center}>
                <Text style={{ color: theme.textMuted, textAlign: 'center' }}>
                  {userQuery.trim().length >= 2
                    ? 'No matching users found.'
                    : 'Tap "New Contact", "Sync", or search by phone / username.'}
                </Text>
              </View>
            }
          />

          {newGroupMode && selectedMemberIds.length > 0 && (
            <TouchableOpacity
              style={[styles.createGroupBtn, { backgroundColor: theme.primary }]}
              onPress={handleCreateGroup}
            >
              <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 16 }}>
                Create Group ({selectedMemberIds.length})
              </Text>
            </TouchableOpacity>
          )}
        </SafeAreaView>
      </Modal>

      <CountryCodePickerModal
        visible={countryPickerOpen}
        selectedCode={newContactCountry.code}
        onClose={() => setCountryPickerOpen(false)}
        onSelect={(c) => {
          setNewContactCountry(c);
          setCountryPickerOpen(false);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 22,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 2 },
  chipsRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  chatInfo: { flex: 1 },
  chatTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  chatTitle: { fontSize: 16, fontWeight: '700', flex: 1, marginRight: 8 },
  chatTime: { fontSize: 12 },
  chatBottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chatPreview: { fontSize: 14, flex: 1, marginRight: 8 },
  badges: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  unreadText: { fontSize: 11, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 10 },
  emptyTitle: { fontSize: 17, fontWeight: '700' },
  retryBtn: { paddingHorizontal: 22, paddingVertical: 10, borderRadius: 20, marginTop: 8 },
  globalSection: { marginTop: 12 },
  sectionHeader: { paddingHorizontal: 14, paddingVertical: 6, fontSize: 12, fontWeight: '700' },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 3 },
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  modalActions: { flexDirection: 'row', padding: 12, gap: 10 },
  actionPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    gap: 8,
  },
  groupInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  createGroupBtn: {
    margin: 16,
    paddingVertical: 14,
    borderRadius: 26,
    alignItems: 'center',
  },
  addContactCard: {
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
  },
  countryBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 11,
    justifyContent: 'center',
  },
  smallBtn: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 10,
    minWidth: 90,
    alignItems: 'center',
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
});

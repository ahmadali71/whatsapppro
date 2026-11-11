import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { extractErrorMessage, RootStackParamList } from '../../types/mobile.types';
import { useAuthStore } from '../../stores/authStore';
import { useChatStore } from '../../stores/chatStore';
import { useTheme } from '../../theme/colors';
import { Avatar } from '../../components/Avatar';

type Props = NativeStackScreenProps<RootStackParamList, 'ProfileSetup'>;

export function ProfileSetupScreen({ route, navigation }: Props) {
  const isOnboarding = route.params?.isOnboarding ?? false;
  const theme = useTheme();
  const { user, updateProfile, isLoading } = useAuthStore();
  const { uploadMediaFile } = useChatStore();

  const [displayName, setDisplayName] = useState(
    user?.displayName && user.displayName !== user.phoneNumber ? user.displayName : '',
  );
  const [username, setUsername] = useState(user?.username || '');
  const [about, setAbout] = useState(user?.about || 'Hey there! I am using WhatsApp Pro.');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user?.avatarUrl ?? null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const pickAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow photo library access to set your profile photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setUploadingAvatar(true);
    try {
      const uploaded = await uploadMediaFile({
        uri: asset.uri,
        name: asset.fileName || `avatar-${Date.now()}.jpg`,
        type: asset.mimeType || 'image/jpeg',
      });
      setAvatarUrl(uploaded.url);
    } catch (err) {
      Alert.alert(
        'Upload Failed',
        `${extractErrorMessage(err, 'Could not upload avatar image.')}\n\nYou can still tap Finish Setup without a photo.`,
      );
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSave = async () => {
    if (!displayName.trim()) {
      Alert.alert('Display Name Required', 'Please enter your name.');
      return;
    }
    if (username.trim() && !/^[a-zA-Z0-9_]{3,30}$/.test(username.trim())) {
      Alert.alert('Invalid Username', 'Username must be 3–30 letters, numbers, or underscores.');
      return;
    }
    try {
      await updateProfile({
        displayName: displayName.trim(),
        username: username.trim() || undefined,
        about: about.trim(),
        avatarUrl: avatarUrl ?? undefined,
      });
      if (isOnboarding) {
        navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
      } else {
        navigation.goBack();
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to update profile.');
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: theme.primary }]}>Profile Info</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          Please provide your name and an optional profile photo.
        </Text>

        <TouchableOpacity style={styles.avatarWrap} onPress={pickAvatar} disabled={uploadingAvatar}>
          <Avatar uri={avatarUrl} name={displayName || user?.phoneNumber} size={110} />
          <View style={[styles.cameraBadge, { backgroundColor: theme.primary }]}>
            {uploadingAvatar ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons name="camera" size={18} color="#FFFFFF" />
            )}
          </View>
        </TouchableOpacity>

        <View style={styles.field}>
          <Text style={[styles.label, { color: theme.textSecondary }]}>Display Name *</Text>
          <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Your name"
            placeholderTextColor={theme.textMuted}
            style={[styles.input, { color: theme.text, borderBottomColor: theme.primary }]}
          />
        </View>

        <View style={styles.field}>
          <Text style={[styles.label, { color: theme.textSecondary }]}>Username (optional)</Text>
          <TextInput
            value={username}
            onChangeText={setUsername}
            placeholder="e.g. alex_pro"
            autoCapitalize="none"
            placeholderTextColor={theme.textMuted}
            style={[styles.input, { color: theme.text, borderBottomColor: theme.border }]}
          />
        </View>

        <View style={styles.field}>
          <Text style={[styles.label, { color: theme.textSecondary }]}>About</Text>
          <TextInput
            value={about}
            onChangeText={setAbout}
            placeholder="Hey there! I am using WhatsApp Pro."
            placeholderTextColor={theme.textMuted}
            style={[styles.input, { color: theme.text, borderBottomColor: theme.border }]}
          />
        </View>

        <TouchableOpacity
          style={[styles.saveBtn, { backgroundColor: theme.primary }]}
          onPress={handleSave}
          disabled={isLoading || uploadingAvatar}
        >
          {isLoading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.saveText}>{isOnboarding ? 'Finish Setup' : 'Save Changes'}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 24, paddingTop: 32 },
  title: { fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 14, textAlign: 'center', marginBottom: 28 },
  avatarWrap: { alignSelf: 'center', marginBottom: 30, position: 'relative' },
  cameraBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  field: { marginBottom: 22 },
  label: { fontSize: 12, fontWeight: '600', marginBottom: 6, textTransform: 'uppercase' },
  input: { borderBottomWidth: 1.5, paddingVertical: 8, fontSize: 16 },
  saveBtn: { borderRadius: 26, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  saveText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});

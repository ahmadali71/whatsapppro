import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  User as UserIcon,
  Shield,
  MessageSquare,
  Bell,
  HardDrive,
  Palette,
  LogOut,
  Camera,
  Lock,
  Smartphone,
  Trash2,
  Phone,
  Ban,
  CloudUpload,
  Check,
  Monitor,
  Sun,
  Moon,
  Loader2,
  Keyboard,
} from 'lucide-react';
import {
  FontSize,
  PrivacyVisibility,
  ThemePreference,
} from '@whatsapp-pro/shared-types';
import { useAuthStore } from '@/stores/authStore';
import { useChatStore } from '@/stores/chatStore';
import { useThemeStore, WALLPAPER_PRESETS } from '@/stores/themeStore';
import {
  AuthSessionItem,
  mediaApi,
  privacyApi,
  settingsApi,
  StorageConversationUsage,
} from '@/services/api.services';
import { COUNTRIES } from '@/lib/countries';
import { extractErrorMessage } from '@/lib/api';
import { Avatar } from '@/components/common/Avatar';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { ImageCropModal } from '@/components/common/ImageCropModal';
import { toast } from '@/stores/toastStore';

type SettingsTab =
  | 'account'
  | 'privacy'
  | 'chats'
  | 'notifications'
  | 'storage'
  | 'appearance'
  | 'keyboard';

function fmtBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const SettingsPage: React.FC<{ initialTab?: SettingsTab }> = ({
  initialTab = 'account',
}) => {
  const navigate = useNavigate();
  const {
    user,
    privacySettings,
    devices,
    updateProfile,
    enable2FA,
    fetchPrivacySettings,
    updatePrivacySettings,
    fetchChatSettings,
    updateChatSettings,
    fetchDevices,
    revokeDevice,
    changeNumber,
    deleteAccount,
    logout,
  } = useAuthStore();

  const {
    conversations,
    blockedUsers,
    fetchBlockedUsers,
    unblockUser,
    muteConversation,
    fetchConversations,
  } = useChatStore();

  const {
    theme,
    wallpaper,
    fontSize,
    enterToSend,
    mediaAutoDownloadWifi,
    mediaAutoDownloadCellular,
    setTheme,
    setWallpaper,
    setFontSize,
    setEnterToSend,
    setMediaAutoDownload,
  } = useThemeStore();

  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  // Profile form
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [username, setUsername] = useState(user?.username || '');
  const [about, setAbout] = useState(user?.about || '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // 2FA form
  const [newPin, setNewPin] = useState('');

  // Change phone form
  const [newDialCode, setNewDialCode] = useState('+1');
  const [newCountryCode, setNewCountryCode] = useState('US');
  const [newPhoneDigits, setNewPhoneDigits] = useState('');
  const [changePhoneOtp, setChangePhoneOtp] = useState('');

  // Sessions & Storage
  const [sessions, setSessions] = useState<AuthSessionItem[]>([]);
  const [storageStats, setStorageStats] = useState<{
    totalBytes: number;
    conversations: StorageConversationUsage[];
  }>({ totalBytes: 0, conversations: [] });
  const [customWallpaperInput, setCustomWallpaperInput] = useState('');
  const [deleteAccountConfirm, setDeleteAccountConfirm] = useState(false);

  useEffect(() => {
    setDisplayName(user?.displayName || '');
    setUsername(user?.username || '');
    setAbout(user?.about || '');
  }, [user]);

  useEffect(() => {
    void fetchPrivacySettings();
    void fetchChatSettings();
    void fetchDevices();
    void fetchBlockedUsers();
    void fetchConversations();
    void privacyApi.getSessions().then(setSessions).catch(() => {});
    void settingsApi.getStorageUsage().then(setStorageStats).catch(() => {});
  }, [
    fetchPrivacySettings,
    fetchChatSettings,
    fetchDevices,
    fetchBlockedUsers,
    fetchConversations,
  ]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await updateProfile({
        displayName: displayName.trim(),
        username: username.trim() || undefined,
        about: about.trim(),
      });
      toast.success('Profile updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setCropFile(file);
  };

  const handleAvatarCropConfirm = async (croppedBlob: Blob) => {
    setCropFile(null);
    setUploadingAvatar(true);
    try {
      const up = await mediaApi.uploadFile(croppedBlob, 'avatars', undefined, 'avatar.jpg');
      await updateProfile({ avatarUrl: up.url });
      toast.success('Profile photo updated');
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to upload photo'));
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleEnable2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPin.length !== 6) {
      toast.error('PIN must be 6 digits');
      return;
    }
    try {
      await enable2FA(newPin);
      setNewPin('');
      toast.success('Two-Step Verification PIN saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to enable 2FA');
    }
  };

  const handleChangeNumber = async (e: React.FormEvent) => {
    e.preventDefault();
    const digits = newPhoneDigits.replace(/\D/g, '').replace(/^0+/, '');
    if (digits.length < 6) {
      toast.error('Enter a valid new phone number');
      return;
    }
    try {
      await changeNumber(`${newDialCode}${digits}`, newCountryCode, changePhoneOtp);
      setNewPhoneDigits('');
      setChangePhoneOtp('');
      toast.success('Phone number updated!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to change number');
    }
  };

  const handlePrivacyChange = async (field: string, value: unknown) => {
    try {
      await updatePrivacySettings({ [field]: value });
      toast.success('Privacy preference saved');
    } catch {
      toast.error('Failed to update privacy setting');
    }
  };

  const handleChatPrefSync = async (updates: {
    theme?: ThemePreference;
    fontSize?: FontSize;
    enterToSend?: boolean;
    mediaAutoDownloadWifi?: boolean;
    mediaAutoDownloadCellular?: boolean;
    wallpaper?: string;
  }) => {
    try {
      await updateChatSettings(updates);
    } catch {
      // Local store still updated
    }
  };

  const handleTriggerBackup = async () => {
    try {
      const res = await settingsApi.triggerBackup();
      toast.success(`Backup completed (${new Date(res.timestamp).toLocaleTimeString()})`);
    } catch {
      toast.error('Backup failed');
    }
  };

  const handleClearStorage = async (conversationId: string) => {
    try {
      await settingsApi.clearConversationMedia(conversationId);
      const refreshed = await settingsApi.getStorageUsage();
      setStorageStats(refreshed);
      toast.success('Conversation media cleared');
    } catch {
      toast.error('Failed to clear media');
    }
  };

  const tabs: Array<{ id: SettingsTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'account', label: 'Account', icon: UserIcon },
    { id: 'privacy', label: 'Privacy', icon: Shield },
    { id: 'chats', label: 'Chats', icon: MessageSquare },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'storage', label: 'Storage & Data', icon: HardDrive },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'keyboard', label: 'Keyboard Shortcuts', icon: Keyboard },
  ];

  return (
    <div className="flex-1 flex flex-col md:flex-row h-full overflow-hidden bg-white dark:bg-[#111b21]">
      {/* Settings Navigation Sidebar */}
      <aside className="w-full md:w-72 border-r border-gray-200 dark:border-[#2a3942] bg-[#f8f9fa] dark:bg-[#111b21] flex flex-col shrink-0">
        <div className="h-14 px-5 bg-[#f0f2f5] dark:bg-[#202c33] border-b border-gray-200 dark:border-[#2a3942] flex items-center justify-between">
          <h1 className="text-lg font-bold">Settings</h1>
          <button
            type="button"
            onClick={() => void logout().then(() => navigate('/auth'))}
            className="text-xs text-red-500 font-semibold flex items-center gap-1 hover:underline"
          >
            <LogOut className="w-4 h-4" /> Logout
          </button>
        </div>

        <div className="p-3 flex md:flex-col gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition ${
                  active
                    ? 'bg-[#00A884]/15 text-[#00A884]'
                    : 'text-[#54656f] dark:text-[#aebac1] hover:bg-gray-200/60 dark:hover:bg-[#202c33]'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Settings Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-[#f0f2f5] dark:bg-[#0b141a]">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* ACCOUNT TAB */}
          {activeTab === 'account' && (
            <>
              <div className="bg-white dark:bg-[#202c33] rounded-2xl p-6 shadow-sm border border-gray-200/70 dark:border-[#2a3942]">
                <h2 className="text-base font-bold mb-4">Profile</h2>
                <form onSubmit={handleSaveProfile} className="space-y-4">
                  <div className="flex items-center gap-4">
                    <label className="relative cursor-pointer group">
                      <Avatar src={user?.avatarUrl} name={user?.displayName} size="xl" />
                      <span className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-[#00A884] text-white flex items-center justify-center shadow">
                        {uploadingAvatar ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Camera className="w-4 h-4" />
                        )}
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleAvatarChange}
                        disabled={uploadingAvatar}
                        className="hidden"
                      />
                    </label>
                    <div>
                      <p className="font-semibold">{user?.displayName}</p>
                      <p className="text-xs text-[#667781] font-mono">{user?.phoneNumber}</p>
                      {uploadingAvatar && (
                        <p className="text-[11px] text-[#00A884] mt-0.5">Uploading photo...</p>
                      )}
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-[#667781] mb-1">Display Name</label>
                      <input
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-sm"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[#667781] mb-1">Username</label>
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-[#667781] mb-1">About</label>
                    <input
                      type="text"
                      value={about}
                      onChange={(e) => setAbout(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={savingProfile}
                    className="px-5 py-2 rounded-xl bg-[#00A884] text-white text-sm font-semibold"
                  >
                    {savingProfile ? 'Saving...' : 'Save Profile'}
                  </button>
                </form>
              </div>

              {/* Two-Step Verification */}
              <div className="bg-white dark:bg-[#202c33] rounded-2xl p-6 shadow-sm border border-gray-200/70 dark:border-[#2a3942]">
                <h2 className="text-base font-bold flex items-center gap-2 mb-1">
                  <Lock className="w-4 h-4 text-[#00A884]" /> Two-Step Verification
                </h2>
                <p className="text-xs text-[#667781] dark:text-[#8696a0] mb-4">
                  Status: {user?.twoFactorEnabled ? 'Enabled' : 'Disabled'}
                </p>
                <form onSubmit={handleEnable2FA} className="flex gap-2">
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="Enter 6-digit PIN"
                    className="flex-1 px-3.5 py-2 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-sm font-mono"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-[#00A884] text-white text-sm font-semibold"
                  >
                    {user?.twoFactorEnabled ? 'Update PIN' : 'Enable 2FA'}
                  </button>
                </form>
              </div>

              {/* Change Phone Number */}
              <div className="bg-white dark:bg-[#202c33] rounded-2xl p-6 shadow-sm border border-gray-200/70 dark:border-[#2a3942]">
                <h2 className="text-base font-bold flex items-center gap-2 mb-3">
                  <Phone className="w-4 h-4 text-[#00A884]" /> Change Phone Number
                </h2>
                <form onSubmit={handleChangeNumber} className="space-y-3">
                  <div className="flex gap-2">
                    <select
                      value={`${newCountryCode}:${newDialCode}`}
                      onChange={(e) => {
                        const [cc, dc] = e.target.value.split(':');
                        setNewCountryCode(cc);
                        setNewDialCode(dc);
                      }}
                      className="px-3 py-2 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-sm"
                    >
                      {COUNTRIES.map((c) => (
                        <option key={`${c.code}-${c.dialCode}`} value={`${c.code}:${c.dialCode}`}>
                          {c.flag} {c.dialCode}
                        </option>
                      ))}
                    </select>
                    <input
                      type="tel"
                      value={newPhoneDigits}
                      onChange={(e) => setNewPhoneDigits(e.target.value)}
                      placeholder="New phone digits"
                      className="flex-1 px-3.5 py-2 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-sm"
                    />
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      maxLength={6}
                      value={changePhoneOtp}
                      onChange={(e) => setChangePhoneOtp(e.target.value.replace(/\D/g, ''))}
                      placeholder="OTP code (if required)"
                      className="flex-1 px-3.5 py-2 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-sm"
                    />
                    <button
                      type="submit"
                      className="px-4 py-2 rounded-xl bg-[#00A884] text-white text-sm font-semibold"
                    >
                      Update Number
                    </button>
                  </div>
                </form>
              </div>

              {/* Linked Devices & Sessions */}
              <div className="bg-white dark:bg-[#202c33] rounded-2xl p-6 shadow-sm border border-gray-200/70 dark:border-[#2a3942] space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold flex items-center gap-2">
                    <Smartphone className="w-4 h-4 text-[#00A884]" /> Linked Devices ({devices.length})
                  </h2>
                  {sessions.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        void privacyApi.revokeAllOtherSessions().then(() => {
                          toast.success('Other sessions revoked');
                          void privacyApi.getSessions().then(setSessions);
                        })
                      }
                      className="text-xs text-red-500 font-semibold hover:underline"
                    >
                      Log out all other sessions
                    </button>
                  )}
                </div>

                {devices.length === 0 && sessions.length === 0 ? (
                  <p className="text-xs text-[#667781]">Only this browser session is active.</p>
                ) : (
                  <div className="space-y-2">
                    {devices.map((d) => (
                      <div
                        key={d.id}
                        className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-[#111b21]"
                      >
                        <div>
                          <p className="text-sm font-medium">{d.deviceName}</p>
                          <p className="text-xs text-[#667781]">
                            {d.platform} · Last active {new Date(d.lastActiveAt).toLocaleString()}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void revokeDevice(d.deviceId || d.id)}
                          className="text-xs text-red-500 font-semibold hover:underline"
                        >
                          Unlink
                        </button>
                      </div>
                    ))}
                    {sessions.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-[#111b21]"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">
                            {s.userAgent || 'Active Session'}
                          </p>
                          <p className="text-[11px] text-[#667781]">
                            IP: {s.ipAddress || 'Unknown'} · Created{' '}
                            {new Date(s.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            void privacyApi.revokeSession(s.id).then(() => {
                              setSessions((prev) => prev.filter((x) => x.id !== s.id));
                              toast.success('Session revoked');
                            })
                          }
                          className="text-xs text-red-500 font-semibold hover:underline shrink-0"
                        >
                          Revoke
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Delete Account */}
              <div className="bg-white dark:bg-[#202c33] rounded-2xl p-6 shadow-sm border border-red-200 dark:border-red-900/40">
                <h2 className="text-base font-bold text-red-600 mb-1">Delete My Account</h2>
                <p className="text-xs text-[#667781] dark:text-[#8696a0] mb-4">
                  Permanently deactivate your account, erase your profile, and remove your linked devices.
                </p>
                <button
                  type="button"
                  onClick={() => setDeleteAccountConfirm(true)}
                  className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" /> Delete Account
                </button>
              </div>
            </>
          )}

          {/* PRIVACY TAB */}
          {activeTab === 'privacy' && (
            <>
              <div className="bg-white dark:bg-[#202c33] rounded-2xl p-6 shadow-sm border border-gray-200/70 dark:border-[#2a3942] space-y-4">
                <h2 className="text-base font-bold">Who can see my personal info</h2>
                {(
                  [
                    { key: 'lastSeenVisibility', label: 'Last Seen' },
                    { key: 'onlineVisibility', label: 'Online Status' },
                    { key: 'profilePhotoVisibility', label: 'Profile Photo' },
                    { key: 'aboutVisibility', label: 'About' },
                    { key: 'statusVisibility', label: 'Status Updates' },
                  ] as const
                ).map((item) => (
                  <div key={item.key} className="flex items-center justify-between py-1">
                    <span className="text-sm">{item.label}</span>
                    <select
                      value={
                        (privacySettings?.[item.key] as PrivacyVisibility) ||
                        PrivacyVisibility.CONTACTS
                      }
                      onChange={(e) => void handlePrivacyChange(item.key, e.target.value)}
                      className="px-3 py-1.5 rounded-xl bg-gray-100 dark:bg-[#111b21] text-xs font-medium"
                    >
                      <option value={PrivacyVisibility.ALL}>Everyone</option>
                      <option value={PrivacyVisibility.CONTACTS}>My Contacts</option>
                      <option value={PrivacyVisibility.NOBODY}>Nobody</option>
                    </select>
                  </div>
                ))}

                <label className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-[#2a3942] cursor-pointer">
                  <div>
                    <p className="text-sm font-medium">Read Receipts</p>
                    <p className="text-xs text-[#667781]">
                      If turned off, you won&apos;t send or receive read receipts.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={privacySettings?.readReceiptsEnabled ?? true}
                    onChange={(e) => void handlePrivacyChange('readReceiptsEnabled', e.target.checked)}
                    className="w-4 h-4 accent-[#00A884]"
                  />
                </label>

                <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-[#2a3942]">
                  <div>
                    <p className="text-sm font-medium">Default Disappearing Messages</p>
                    <p className="text-xs text-[#667781]">Start new chats with disappearing timer</p>
                  </div>
                  <select
                    value={privacySettings?.disappearingMessagesDefault || 0}
                    onChange={(e) =>
                      void handlePrivacyChange(
                        'disappearingMessagesDefault',
                        Number(e.target.value) || null,
                      )
                    }
                    className="px-3 py-1.5 rounded-xl bg-gray-100 dark:bg-[#111b21] text-xs font-medium"
                  >
                    <option value={0}>Off</option>
                    <option value={86400}>24 hours</option>
                    <option value={604800}>7 days</option>
                    <option value={7776000}>90 days</option>
                  </select>
                </div>
              </div>

              <div className="bg-white dark:bg-[#202c33] rounded-2xl p-6 shadow-sm border border-gray-200/70 dark:border-[#2a3942]">
                <h2 className="text-base font-bold flex items-center gap-2 mb-3">
                  <Ban className="w-4 h-4 text-red-500" /> Blocked Contacts ({blockedUsers.length})
                </h2>
                {blockedUsers.length === 0 ? (
                  <p className="text-xs text-[#667781]">You haven&apos;t blocked anyone.</p>
                ) : (
                  <div className="space-y-2">
                    {blockedUsers.map((u) => (
                      <div
                        key={u.id}
                        className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 dark:bg-[#111b21]"
                      >
                        <div className="flex items-center gap-2.5">
                          <Avatar src={u.avatarUrl} name={u.displayName} size="sm" />
                          <span className="text-sm font-medium">{u.displayName}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => void unblockUser(u.id)}
                          className="text-xs text-[#00A884] font-semibold hover:underline"
                        >
                          Unblock
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* CHATS TAB */}
          {activeTab === 'chats' && (
            <div className="bg-white dark:bg-[#202c33] rounded-2xl p-6 shadow-sm border border-gray-200/70 dark:border-[#2a3942] space-y-5">
              <div>
                <h2 className="text-base font-bold mb-3">Chat Wallpaper</h2>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5 mb-3">
                  {WALLPAPER_PRESETS.map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => {
                        setWallpaper(w.id);
                        void handleChatPrefSync({ wallpaper: w.id });
                      }}
                      className={`p-2 rounded-xl border text-center transition ${
                        wallpaper === w.id
                          ? 'border-[#00A884] ring-2 ring-[#00A884]/30'
                          : 'border-gray-200 dark:border-[#2a3942]'
                      }`}
                    >
                      <div
                        className="h-12 rounded-lg mb-1.5 border border-black/10"
                        style={{ backgroundColor: w.lightBg }}
                      />
                      <span className="text-[11px] font-medium block truncate">{w.label}</span>
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={customWallpaperInput}
                    onChange={(e) => setCustomWallpaperInput(e.target.value)}
                    placeholder="Or paste custom wallpaper image URL..."
                    className="flex-1 px-3 py-1.5 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (customWallpaperInput.trim()) {
                        setWallpaper('custom', customWallpaperInput.trim());
                        void handleChatPrefSync({ wallpaper: customWallpaperInput.trim() });
                        toast.success('Custom wallpaper applied');
                      }
                    }}
                    className="px-3 py-1.5 rounded-xl bg-[#00A884] text-white text-xs font-semibold"
                  >
                    Apply
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-[#2a3942]">
                <span className="text-sm font-medium">Font Size</span>
                <select
                  value={fontSize}
                  onChange={(e) => {
                    const val = e.target.value as FontSize;
                    setFontSize(val);
                    void handleChatPrefSync({ fontSize: val });
                  }}
                  className="px-3 py-1.5 rounded-xl bg-gray-100 dark:bg-[#111b21] text-xs font-medium"
                >
                  <option value={FontSize.SMALL}>Small</option>
                  <option value={FontSize.MEDIUM}>Medium</option>
                  <option value={FontSize.LARGE}>Large</option>
                </select>
              </div>

              <label className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-[#2a3942] cursor-pointer">
                <div>
                  <p className="text-sm font-medium">Enter is Send</p>
                  <p className="text-xs text-[#667781]">Pressing Enter sends your message</p>
                </div>
                <input
                  type="checkbox"
                  checked={enterToSend}
                  onChange={(e) => {
                    setEnterToSend(e.target.checked);
                    void handleChatPrefSync({ enterToSend: e.target.checked });
                  }}
                  className="w-4 h-4 accent-[#00A884]"
                />
              </label>

              <div className="space-y-2.5 pt-3 border-t border-gray-100 dark:border-[#2a3942]">
                <p className="text-sm font-medium">Media Auto-Download</p>
                <label className="flex items-center justify-between text-xs cursor-pointer">
                  <span>When connected on Wi-Fi</span>
                  <input
                    type="checkbox"
                    checked={mediaAutoDownloadWifi}
                    onChange={(e) => {
                      setMediaAutoDownload(e.target.checked, mediaAutoDownloadCellular);
                      void handleChatPrefSync({ mediaAutoDownloadWifi: e.target.checked });
                    }}
                    className="accent-[#00A884]"
                  />
                </label>
                <label className="flex items-center justify-between text-xs cursor-pointer">
                  <span>When using mobile data</span>
                  <input
                    type="checkbox"
                    checked={mediaAutoDownloadCellular}
                    onChange={(e) => {
                      setMediaAutoDownload(mediaAutoDownloadWifi, e.target.checked);
                      void handleChatPrefSync({ mediaAutoDownloadCellular: e.target.checked });
                    }}
                    className="accent-[#00A884]"
                  />
                </label>
              </div>

              <div className="pt-3 border-t border-gray-100 dark:border-[#2a3942] flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Chat Backup</p>
                  <p className="text-xs text-[#667781]">Back up conversation metadata & settings</p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleTriggerBackup()}
                  className="px-4 py-2 rounded-xl bg-[#00A884] text-white text-xs font-semibold flex items-center gap-1.5"
                >
                  <CloudUpload className="w-4 h-4" /> Back Up Now
                </button>
              </div>
            </div>
          )}

          {/* NOTIFICATIONS TAB */}
          {activeTab === 'notifications' && (
            <div className="bg-white dark:bg-[#202c33] rounded-2xl p-6 shadow-sm border border-gray-200/70 dark:border-[#2a3942] space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold">Browser Desktop Notifications</h2>
                  <p className="text-xs text-[#667781]">Receive alerts for new messages & calls</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if ('Notification' in window) {
                      void Notification.requestPermission().then((perm) =>
                        toast.info(`Notification permission: ${perm}`),
                      );
                    }
                  }}
                  className="px-4 py-2 rounded-xl bg-[#00A884] text-white text-xs font-semibold"
                >
                  Enable Alerts
                </button>
              </div>

              <div className="pt-4 border-t border-gray-100 dark:border-[#2a3942]">
                <h3 className="text-sm font-semibold mb-2">Conversation Mute Preferences</h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {conversations.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 dark:bg-[#111b21]"
                    >
                      <span className="text-sm font-medium truncate">
                        {c.group?.name ||
                          c.members?.find((m) => m.userId !== user?.id)?.user?.displayName ||
                          'Chat'}
                      </span>
                      <button
                        type="button"
                        onClick={() => void muteConversation(c.id, !c.isMuted)}
                        className={`px-3 py-1 rounded-full text-xs font-semibold ${
                          c.isMuted
                            ? 'bg-amber-500/15 text-amber-500'
                            : 'bg-[#00A884]/15 text-[#00A884]'
                        }`}
                      >
                        {c.isMuted ? 'Muted' : 'Active'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STORAGE TAB */}
          {activeTab === 'storage' && (
            <div className="bg-white dark:bg-[#202c33] rounded-2xl p-6 shadow-sm border border-gray-200/70 dark:border-[#2a3942] space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold">Storage Usage</h2>
                  <p className="text-xs text-[#667781]">Manage media attachments per chat</p>
                </div>
                <span className="text-lg font-bold text-[#00A884]">
                  {fmtBytes(storageStats.totalBytes)}
                </span>
              </div>

              <div className="divide-y divide-gray-100 dark:divide-[#2a3942]">
                {storageStats.conversations.length === 0 ? (
                  <p className="text-xs text-[#667781] py-4">No media files stored yet.</p>
                ) : (
                  storageStats.conversations.map((item) => (
                    <div key={item.conversationId} className="py-3 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">
                          {item.name || `Chat ${item.conversationId.slice(0, 8)}`}
                        </p>
                        <p className="text-xs text-[#667781]">
                          {item.mediaCount} files · {fmtBytes(item.totalBytes)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleClearStorage(item.conversationId)}
                        className="px-3 py-1.5 rounded-lg text-xs text-red-500 hover:bg-red-500/10 font-semibold"
                      >
                        Clear Media
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* APPEARANCE TAB */}
          {activeTab === 'appearance' && (
            <div className="bg-white dark:bg-[#202c33] rounded-2xl p-6 shadow-sm border border-gray-200/70 dark:border-[#2a3942]">
              <h2 className="text-base font-bold mb-4">Theme</h2>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { id: ThemePreference.LIGHT, label: 'Light', icon: Sun },
                  { id: ThemePreference.DARK, label: 'Dark', icon: Moon },
                  { id: ThemePreference.SYSTEM, label: 'System', icon: Monitor },
                ].map((opt) => {
                  const Icon = opt.icon;
                  const active = theme === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setTheme(opt.id);
                        void handleChatPrefSync({ theme: opt.id });
                      }}
                      className={`p-4 rounded-2xl border flex flex-col items-center gap-2 transition ${
                        active
                          ? 'border-[#00A884] bg-[#00A884]/10 text-[#00A884]'
                          : 'border-gray-200 dark:border-[#2a3942] hover:bg-gray-50 dark:hover:bg-[#111b21]'
                      }`}
                    >
                      <Icon className="w-6 h-6" />
                      <span className="text-sm font-semibold">{opt.label}</span>
                      {active && <Check className="w-4 h-4" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* KEYBOARD SHORTCUTS TAB */}
          {activeTab === 'keyboard' && (
            <div className="bg-white dark:bg-[#202c33] rounded-2xl p-6 shadow-sm border border-gray-200/70 dark:border-[#2a3942]">
              <h2 className="text-base font-bold mb-1">Keyboard Shortcuts</h2>
              <p className="text-xs text-[#667781] dark:text-[#8696a0] mb-4">
                Navigate and reply faster using keyboard shortcuts on WhatsApp Pro Web.
              </p>
              <div className="divide-y divide-gray-100 dark:divide-[#2a3942]">
                {[
                  { keys: 'Ctrl / Cmd + K', desc: 'Open global search across chats, messages & contacts' },
                  { keys: 'Enter', desc: 'Send message (when Enter-is-Send is enabled)' },
                  { keys: 'Shift + Enter', desc: 'Insert a new line in the message composer' },
                  { keys: 'Ctrl / Cmd + V', desc: 'Paste image directly from clipboard into active chat' },
                  { keys: '@username', desc: 'Mention a group participant while typing' },
                  { keys: 'Drag & Drop', desc: 'Drop any image, video, or document onto chat to send' },
                ].map((item) => (
                  <div key={item.keys} className="flex items-center justify-between py-3 gap-4 text-sm">
                    <span className="text-[#54656f] dark:text-[#aebac1]">{item.desc}</span>
                    <kbd className="px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-[#111b21] border border-gray-200 dark:border-[#2a3942] font-mono text-xs shrink-0">
                      {item.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        open={deleteAccountConfirm}
        title="Delete your WhatsApp Pro account?"
        description="This action cannot be undone. Your account will be deactivated and all active sessions will be terminated."
        confirmLabel="Delete Forever"
        danger
        onCancel={() => setDeleteAccountConfirm(false)}
        onConfirm={() => {
          void deleteAccount().then(() => {
            setDeleteAccountConfirm(false);
            toast.success('Account deleted');
            navigate('/auth', { replace: true });
          });
        }}
      />

      <ImageCropModal
        file={cropFile}
        shape="circle"
        title="Crop Profile Photo"
        onCancel={() => setCropFile(null)}
        onConfirm={(blob) => void handleAvatarCropConfirm(blob)}
      />
    </div>
  );
};

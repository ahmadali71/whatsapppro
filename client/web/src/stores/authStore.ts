import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  ChatSettings,
  PrivacySettings,
  User,
  UserDevice,
} from '@whatsapp-pro/shared-types';
import {
  api,
  clearStoredTokens,
  extractErrorMessage,
  getOrCreateDeviceId,
  getStoredTokens,
  registerUnauthorizedHandler,
  setStoredTokens,
  unwrapData,
} from '@/lib/api';
import { socketManager } from '@/lib/socket';
import { e2eeManager } from '@/lib/e2ee';

interface AuthResultPayload {
  user: User;
  accessToken?: string;
  refreshToken?: string;
  access_token?: string;
  refresh_token?: string;
  requiresTwoFactor?: boolean;
  requires_two_factor?: boolean;
  isNewUser?: boolean;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isInitialized: boolean;
  isLoading: boolean;
  requires2FA: boolean;
  is2FAVerified: boolean;
  privacySettings: PrivacySettings | null;
  chatSettings: ChatSettings | null;
  devices: UserDevice[];
  devOtp: string | null;
  error: string | null;

  initializeAuth: () => Promise<void>;
  sendOtp: (phoneNumber: string, countryCode: string) => Promise<{ devOtp?: string }>;
  verifyOtp: (phoneNumber: string, otpCode: string) => Promise<{ isNewUser: boolean; requires2FA: boolean }>;
  register: (payload: {
    phone: string;
    country_code: string;
    display_name: string;
    username?: string;
  }) => Promise<User>;
  loginWithOtp: (phoneNumber: string, otpCode: string) => Promise<{ requires2FA: boolean }>;
  verify2FA: (pin: string) => Promise<void>;
  enable2FA: (pin: string) => Promise<void>;
  logout: () => Promise<void>;
  clearDevOtp: () => void;
  refreshProfile: () => Promise<User | null>;
  updateProfile: (payload: {
    displayName?: string;
    username?: string;
    about?: string;
    avatarUrl?: string;
  }) => Promise<User>;
  fetchPrivacySettings: () => Promise<PrivacySettings | null>;
  updatePrivacySettings: (payload: Partial<PrivacySettings>) => Promise<PrivacySettings>;
  fetchChatSettings: () => Promise<ChatSettings | null>;
  updateChatSettings: (payload: Partial<ChatSettings>) => Promise<ChatSettings>;
  fetchDevices: () => Promise<UserDevice[]>;
  revokeDevice: (deviceId: string) => Promise<void>;
  changeNumber: (newPhoneNumber: string, countryCode: string, otpCode: string) => Promise<void>;
  deleteAccount: () => Promise<void>;
  clearError: () => void;
}

function getDeviceInfo() {
  return {
    device_id: getOrCreateDeviceId(),
    device_name: typeof navigator !== 'undefined' ? `${navigator.platform || 'Web'} Browser` : 'Web Browser',
    platform: 'web',
  };
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => {
      registerUnauthorizedHandler(() => {
        socketManager.disconnect();
        set({
          user: null,
          isAuthenticated: false,
          requires2FA: false,
          is2FAVerified: false,
        });
      });

      return {
        user: null,
        isAuthenticated: false,
        isInitialized: false,
        isLoading: false,
        requires2FA: false,
        is2FAVerified: true,
        privacySettings: null,
        chatSettings: null,
        devices: [],
        devOtp: null,
        error: null,

        clearError: () => set({ error: null }),
        clearDevOtp: () => set({ devOtp: null }),

        initializeAuth: async () => {
          const { accessToken } = getStoredTokens();
          if (!accessToken) {
            set({ isInitialized: true, isAuthenticated: false, user: null });
            return;
          }
          try {
            const res = await api.get('/users/me');
            const user = unwrapData<User>(res.data);
            set({
              user,
              isAuthenticated: true,
              isInitialized: true,
              requires2FA: false,
            });
            socketManager.connect(accessToken);
            void e2eeManager.initializeAndUploadKeys();
          } catch {
            clearStoredTokens();
            set({
              user: null,
              isAuthenticated: false,
              isInitialized: true,
            });
          }
        },

        sendOtp: async (phoneNumber, countryCode) => {
          set({ isLoading: true, error: null });
          try {
            const res = await api.post('/auth/send-otp', {
              phone_number: phoneNumber,
              country_code: countryCode,
            });
            const raw = res.data as Record<string, unknown> | undefined;
            const data = unwrapData<{ otp?: string; devOtp?: string; dev_otp?: string }>(res.data);
            const devOtp =
              data?.dev_otp ||
              data?.devOtp ||
              data?.otp ||
              (typeof raw?.dev_otp === 'string' ? raw.dev_otp : undefined);
            set({ isLoading: false, devOtp: devOtp || null });
            return { devOtp };
          } catch (err) {
            const msg = extractErrorMessage(err, 'Failed to send OTP');
            set({ isLoading: false, error: msg });
            throw new Error(msg);
          }
        },

        verifyOtp: async (phoneNumber, otpCode) => {
          set({ isLoading: true, error: null });
          try {
            const res = await api.post('/auth/verify-otp', {
              phone_number: phoneNumber,
              otp_code: otpCode,
              device_info: getDeviceInfo(),
            });
            const payload = unwrapData<AuthResultPayload>(res.data);
            const access = payload.accessToken || payload.access_token || null;
            const refresh = payload.refreshToken || payload.refresh_token || null;

            if (access) {
              setStoredTokens(access, refresh);
              socketManager.connect(access);
              void e2eeManager.initializeAndUploadKeys();
            }

            const requires2FA = Boolean(
              payload.requiresTwoFactor ?? payload.requires_two_factor ?? payload.user?.twoFactorEnabled,
            );

            set({
              user: payload.user,
              isAuthenticated: Boolean(access),
              requires2FA,
              is2FAVerified: !requires2FA,
              devOtp: null,
              isLoading: false,
            });

            return {
              isNewUser: Boolean(payload.isNewUser || !payload.user?.displayName),
              requires2FA,
            };
          } catch (err) {
            const msg = extractErrorMessage(err, 'Invalid OTP code');
            set({ isLoading: false, error: msg });
            throw new Error(msg);
          }
        },

        register: async (payload) => {
          set({ isLoading: true, error: null });
          try {
            const res = await api.post('/auth/register', payload);
            const raw = res.data as Record<string, unknown> | undefined;
            const data = unwrapData<
              (AuthResultPayload | User) & { dev_otp?: string; devOtp?: string; otp_sent?: boolean }
            >(res.data);
            const user = (data as AuthResultPayload).user || (data as User);
            const access = (data as AuthResultPayload).accessToken || (data as AuthResultPayload).access_token;
            const refresh = (data as AuthResultPayload).refreshToken || (data as AuthResultPayload).refresh_token;
            const devOtp =
              data?.dev_otp ||
              data?.devOtp ||
              (typeof raw?.dev_otp === 'string' ? raw.dev_otp : undefined);
            if (access) {
              setStoredTokens(access, refresh || null);
              socketManager.connect(access);
              void e2eeManager.initializeAndUploadKeys();
            }
            set({
              user,
              isAuthenticated: Boolean(access || get().isAuthenticated),
              devOtp: devOtp || null,
              isLoading: false,
            });
            return user;
          } catch (err) {
            const msg = extractErrorMessage(err, 'Registration failed');
            set({ isLoading: false, error: msg });
            throw new Error(msg);
          }
        },

        loginWithOtp: async (phoneNumber, otpCode) => {
          set({ isLoading: true, error: null });
          try {
            const res = await api.post('/auth/login', {
              phone_number: phoneNumber,
              otp_code: otpCode,
              device_info: getDeviceInfo(),
            });
            const payload = unwrapData<AuthResultPayload>(res.data);
            const access = payload.accessToken || payload.access_token || null;
            const refresh = payload.refreshToken || payload.refresh_token || null;
            if (access) {
              setStoredTokens(access, refresh);
              socketManager.connect(access);
              void e2eeManager.initializeAndUploadKeys();
            }
            const requires2FA = Boolean(
              payload.requiresTwoFactor ?? payload.requires_two_factor ?? payload.user?.twoFactorEnabled,
            );
            set({
              user: payload.user,
              isAuthenticated: Boolean(access),
              requires2FA,
              is2FAVerified: !requires2FA,
              isLoading: false,
            });
            return { requires2FA };
          } catch (err) {
            const msg = extractErrorMessage(err, 'Login failed');
            set({ isLoading: false, error: msg });
            throw new Error(msg);
          }
        },

        verify2FA: async (pin) => {
          set({ isLoading: true, error: null });
          try {
            await api.post('/auth/two-factor/verify', { pin });
            set({ requires2FA: false, is2FAVerified: true, isLoading: false });
          } catch (err) {
            const msg = extractErrorMessage(err, 'Invalid 2FA PIN');
            set({ isLoading: false, error: msg });
            throw new Error(msg);
          }
        },

        enable2FA: async (pin) => {
          set({ isLoading: true, error: null });
          try {
            await api.post('/auth/two-factor/enable', { pin });
            const curr = get().user;
            if (curr) {
              set({ user: { ...curr, twoFactorEnabled: true }, isLoading: false });
            } else {
              set({ isLoading: false });
            }
          } catch (err) {
            const msg = extractErrorMessage(err, 'Failed to enable 2FA');
            set({ isLoading: false, error: msg });
            throw new Error(msg);
          }
        },

        logout: async () => {
          try {
            await api.post('/auth/logout');
          } catch {
            // Best effort
          } finally {
            clearStoredTokens();
            socketManager.disconnect();
            set({
              user: null,
              isAuthenticated: false,
              requires2FA: false,
              is2FAVerified: true,
              devices: [],
              devOtp: null,
            });
          }
        },

        refreshProfile: async () => {
          try {
            const res = await api.get('/users/me');
            const user = unwrapData<User>(res.data);
            set({ user });
            return user;
          } catch {
            return null;
          }
        },

        updateProfile: async (payload) => {
          set({ isLoading: true, error: null });
          try {
            const body: Record<string, unknown> = {};
            if (payload.displayName !== undefined) body.display_name = payload.displayName;
            if (payload.username !== undefined) body.username = payload.username;
            if (payload.about !== undefined) body.about = payload.about;
            if (payload.avatarUrl !== undefined) body.avatar_url = payload.avatarUrl;
            const res = await api.patch('/users/me', body);
            const user = unwrapData<User>(res.data);
            set({ user, isLoading: false });
            return user;
          } catch (err) {
            const msg = extractErrorMessage(err, 'Failed to update profile');
            set({ isLoading: false, error: msg });
            throw new Error(msg);
          }
        },

        fetchPrivacySettings: async () => {
          try {
            const res = await api.get('/privacy/settings');
            const privacySettings = unwrapData<PrivacySettings>(res.data);
            set({ privacySettings });
            return privacySettings;
          } catch {
            return null;
          }
        },

        updatePrivacySettings: async (payload) => {
          const res = await api.patch('/privacy/settings', payload);
          const privacySettings = unwrapData<PrivacySettings>(res.data);
          set({ privacySettings });
          return privacySettings;
        },

        fetchChatSettings: async () => {
          try {
            const res = await api.get('/settings/chat');
            const chatSettings = unwrapData<ChatSettings>(res.data);
            set({ chatSettings });
            return chatSettings;
          } catch {
            return null;
          }
        },

        updateChatSettings: async (payload) => {
          const res = await api.patch('/settings/chat', payload);
          const chatSettings = unwrapData<ChatSettings>(res.data);
          set({ chatSettings });
          return chatSettings;
        },

        fetchDevices: async () => {
          try {
            const res = await api.get('/users/devices');
            const devices = unwrapData<UserDevice[]>(res.data);
            const list = Array.isArray(devices) ? devices : [];
            set({ devices: list });
            return list;
          } catch {
            return get().devices;
          }
        },

        revokeDevice: async (deviceId) => {
          await api.delete(`/users/devices/${deviceId}`);
          set((s) => ({ devices: s.devices.filter((d) => d.id !== deviceId && d.deviceId !== deviceId) }));
        },

        changeNumber: async (newPhoneNumber, countryCode, otpCode) => {
          const res = await api.post('/users/change-number', {
            new_phone_number: newPhoneNumber,
            new_country_code: countryCode,
            otp_code: otpCode || undefined,
          });
          const updated = unwrapData<User>(res.data);
          if (updated) set({ user: updated });
        },

        deleteAccount: async () => {
          await api.delete('/users/me');
          clearStoredTokens();
          socketManager.disconnect();
          set({ user: null, isAuthenticated: false });
        },
      };
    },
    {
      name: 'wp-auth-store',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);

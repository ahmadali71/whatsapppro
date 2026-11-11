import { create } from 'zustand';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as LocalAuthentication from 'expo-local-authentication';
import { User } from '@whatsapp-pro/shared-types';
import api, {
  clearAuthTokens,
  getAccessToken,
  getOrCreateDeviceId,
  hydrateApiBaseUrl,
  saveAuthTokens,
  secureStorage,
  setOnUnauthorizedHandler,
} from '../services/api';
import socketService from '../services/socket';
import notificationsService from '../services/notifications';
import e2eeService from '../services/e2ee';
import { extractErrorMessage, normalizeUser, unwrapApiData } from '../types/mobile.types';
import { useThemeStore } from './themeStore';

const BIOMETRIC_PREF_KEY = 'whatsapp_pro_biometric_lock';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isBootstrapping: boolean;
  isLoading: boolean;
  error: string | null;
  devOtp: string | null;
  needsProfileSetup: boolean;
  requiresTwoFactor: boolean;
  biometricEnabled: boolean;
  isBiometricLocked: boolean;

  bootstrap: () => Promise<void>;
  startPhoneAuth: (phoneNumber: string, countryCode: string) => Promise<{ devOtp?: string }>;
  sendOtp: (phoneNumber: string, countryCode: string) => Promise<{ devOtp?: string }>;
  verifyOtp: (
    phoneNumber: string,
    otpCode: string,
  ) => Promise<{ isNewUser: boolean; requiresTwoFactor: boolean }>;
  registerProfile: (payload: {
    phone: string;
    countryCode: string;
    displayName: string;
    username?: string;
    about?: string;
    avatarUrl?: string;
  }) => Promise<void>;
  updateProfile: (payload: {
    displayName?: string;
    username?: string;
    about?: string;
    avatarUrl?: string;
  }) => Promise<User>;
  verifyTwoFactor: (pin: string) => Promise<void>;
  enableTwoFactor: (pin: string) => Promise<void>;
  refreshMe: () => Promise<User | null>;
  logout: () => Promise<void>;
  setBiometricEnabled: (enabled: boolean) => Promise<boolean>;
  unlockWithBiometrics: () => Promise<boolean>;
  lockIfEnabled: () => void;
  clearError: () => void;
}

async function onAuthenticatedSetup(user: User) {
  await socketService.connect();
  notificationsService.registerAndSyncPushToken().catch(() => {});
  e2eeService.publishKeyBundle().catch(() => {});
  useThemeStore.getState().syncFromServer().catch(() => {});
  return user;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isBootstrapping: true,
  isLoading: false,
  error: null,
  devOtp: null,
  needsProfileSetup: false,
  requiresTwoFactor: false,
  biometricEnabled: false,
  isBiometricLocked: false,

  clearError: () => set({ error: null }),

  bootstrap: async () => {
    set({ isBootstrapping: true });
    await hydrateApiBaseUrl();
    await useThemeStore.getState().hydrateTheme();

    setOnUnauthorizedHandler(() => {
      socketService.disconnect();
      set({
        user: null,
        isAuthenticated: false,
        requiresTwoFactor: false,
        needsProfileSetup: false,
        isBiometricLocked: false,
        devOtp: null,
      });
    });

    const biometricPref = (await secureStorage.getItem(BIOMETRIC_PREF_KEY)) === 'true';
    set({ biometricEnabled: biometricPref });

    const token = await getAccessToken();
    if (!token) {
      set({ isBootstrapping: false, isAuthenticated: false, user: null });
      return;
    }

    try {
      const res = await api.get('/users/me');
      const rawUser = unwrapApiData<Record<string, unknown>>(res.data);
      const user = normalizeUser(rawUser);
      set({
        user,
        isAuthenticated: true,
        isBiometricLocked: biometricPref,
        needsProfileSetup: !user.displayName || user.displayName === user.phoneNumber,
      });
      await onAuthenticatedSetup(user);
    } catch {
      await clearAuthTokens();
      set({ user: null, isAuthenticated: false, isBiometricLocked: false });
    } finally {
      set({ isBootstrapping: false });
    }
  },

  startPhoneAuth: async (phoneNumber, countryCode) => {
    set({ isLoading: true, error: null, devOtp: null });
    try {
      // Ensure new users exist in DB before OTP verification; fall back to send-otp if already verified (409)
      try {
        const regRes = await api.post('/auth/register', {
          phone: phoneNumber,
          country_code: countryCode,
          display_name: phoneNumber,
        });
        const regData = unwrapApiData<{ otp?: string; devOtp?: string; dev_otp?: string }>(regRes.data);
        const devOtp = regData?.dev_otp ?? regData?.devOtp ?? regData?.otp;
        set({ devOtp: devOtp ?? null });
        return { devOtp };
      } catch (regErr: any) {
        if (regErr?.response?.status !== 409) {
          throw regErr;
        }
      }

      const otpRes = await api.post('/auth/send-otp', {
        phone_number: phoneNumber,
        country_code: countryCode,
      });
      const data = unwrapApiData<{ otp?: string; devOtp?: string; dev_otp?: string }>(otpRes.data);
      const devOtp = data?.dev_otp ?? data?.devOtp ?? data?.otp;
      set({ devOtp: devOtp ?? null });
      return { devOtp };
    } catch (err) {
      const msg = extractErrorMessage(err, 'Failed to send verification code');
      set({ error: msg });
      throw new Error(msg);
    } finally {
      set({ isLoading: false });
    }
  },

  sendOtp: async (phoneNumber, countryCode) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.post('/auth/send-otp', {
        phone_number: phoneNumber,
        country_code: countryCode,
      });
      const data = unwrapApiData<{ otp?: string; devOtp?: string; dev_otp?: string }>(res.data);
      const devOtp = data?.dev_otp ?? data?.devOtp ?? data?.otp;
      set({ devOtp: devOtp ?? null });
      return { devOtp };
    } catch (err) {
      const msg = extractErrorMessage(err, 'Failed to send verification code');
      set({ error: msg });
      throw new Error(msg);
    } finally {
      set({ isLoading: false });
    }
  },

  verifyOtp: async (phoneNumber, otpCode) => {
    set({ isLoading: true, error: null });
    try {
      const deviceId = await getOrCreateDeviceId();
      const res = await api.post('/auth/verify-otp', {
        phone_number: phoneNumber,
        otp_code: otpCode,
        device_info: {
          device_id: deviceId,
          device_name: Device.modelName || `${Platform.OS} Device`,
          platform: Platform.OS.toUpperCase(),
        },
      });
      const data = unwrapApiData<Record<string, any>>(res.data);
      const accessToken = data.accessToken ?? data.access_token ?? data.tokens?.accessToken;
      const refreshToken = data.refreshToken ?? data.refresh_token ?? data.tokens?.refreshToken;
      if (accessToken) {
        await saveAuthTokens(accessToken, refreshToken);
      }

      const rawUser = (data.user ?? {}) as Record<string, unknown>;
      const user = normalizeUser(rawUser);
      const isNewUser = Boolean(
        data.isNewUser ?? data.is_new_user ?? (!user.displayName || user.displayName === user.phoneNumber),
      );
      const requiresTwoFactor = Boolean(data.requiresTwoFactor ?? data.requires_two_factor ?? user.twoFactorEnabled);

      set({
        user,
        isAuthenticated: !requiresTwoFactor,
        requiresTwoFactor,
        needsProfileSetup: isNewUser,
        devOtp: null,
      });

      if (!requiresTwoFactor) {
        await onAuthenticatedSetup(user);
      }

      return { isNewUser, requiresTwoFactor };
    } catch (err) {
      const msg = extractErrorMessage(err, 'Invalid verification code');
      set({ error: msg });
      throw new Error(msg);
    } finally {
      set({ isLoading: false });
    }
  },

  registerProfile: async ({ phone, countryCode, displayName, username, about, avatarUrl }) => {
    set({ isLoading: true, error: null });
    try {
      const existingToken = await getAccessToken();
      if (existingToken) {
        const updated = await get().updateProfile({ displayName, username, about, avatarUrl });
        set({ needsProfileSetup: false, isAuthenticated: true, user: updated });
        await onAuthenticatedSetup(updated);
        return;
      }

      const res = await api.post('/auth/register', {
        phone,
        country_code: countryCode,
        display_name: displayName,
        username: username || undefined,
      });
      const data = unwrapApiData<Record<string, any>>(res.data);
      const accessToken = data.accessToken ?? data.access_token;
      const refreshToken = data.refreshToken ?? data.refresh_token;
      if (accessToken) {
        await saveAuthTokens(accessToken, refreshToken);
      }
      const user = normalizeUser((data.user ?? data) as Record<string, unknown>);
      set({ user, isAuthenticated: true, needsProfileSetup: false });
      await onAuthenticatedSetup(user);
    } catch (err) {
      const msg = extractErrorMessage(err, 'Failed to save profile');
      set({ error: msg });
      throw new Error(msg);
    } finally {
      set({ isLoading: false });
    }
  },

  updateProfile: async ({ displayName, username, about, avatarUrl }) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.patch('/users/me', {
        ...(displayName !== undefined ? { display_name: displayName } : {}),
        ...(username?.trim() ? { username: username.trim() } : {}),
        ...(about !== undefined ? { about } : {}),
        ...(avatarUrl !== undefined ? { avatar_url: avatarUrl } : {}),
      });
      const user = normalizeUser(unwrapApiData<Record<string, unknown>>(res.data));
      set({ user, needsProfileSetup: false });
      return user;
    } catch (err) {
      const msg = extractErrorMessage(err, 'Failed to update profile');
      set({ error: msg });
      throw new Error(msg);
    } finally {
      set({ isLoading: false });
    }
  },

  verifyTwoFactor: async (pin) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.post('/auth/two-factor/verify', { pin });
      const data = unwrapApiData<Record<string, any>>(res.data);
      const accessToken = data.accessToken ?? data.access_token;
      const refreshToken = data.refreshToken ?? data.refresh_token;
      if (accessToken) {
        await saveAuthTokens(accessToken, refreshToken);
      }
      const user = data.user ? normalizeUser(data.user) : get().user;
      set({
        user,
        requiresTwoFactor: false,
        isAuthenticated: true,
      });
      if (user) {
        await onAuthenticatedSetup(user);
      }
    } catch (err) {
      const msg = extractErrorMessage(err, 'Incorrect 2FA PIN');
      set({ error: msg });
      throw new Error(msg);
    } finally {
      set({ isLoading: false });
    }
  },

  enableTwoFactor: async (pin) => {
    set({ isLoading: true, error: null });
    try {
      await api.post('/auth/two-factor/enable', { pin });
      const current = get().user;
      if (current) {
        set({ user: { ...current, twoFactorEnabled: true } });
      }
    } catch (err) {
      const msg = extractErrorMessage(err, 'Failed to enable Two-Step Verification');
      set({ error: msg });
      throw new Error(msg);
    } finally {
      set({ isLoading: false });
    }
  },

  refreshMe: async () => {
    try {
      const res = await api.get('/users/me');
      const user = normalizeUser(unwrapApiData<Record<string, unknown>>(res.data));
      set({ user });
      return user;
    } catch {
      return null;
    }
  },

  logout: async () => {
    set({ isLoading: true });
    try {
      await api.post('/auth/logout');
    } catch {
      // Always clear local session even if server call fails
    } finally {
      socketService.disconnect();
      await clearAuthTokens();
      await e2eeService.clearKeys();
      set({
        user: null,
        isAuthenticated: false,
        requiresTwoFactor: false,
        needsProfileSetup: false,
        isBiometricLocked: false,
        isLoading: false,
        error: null,
        devOtp: null,
      });
    }
  },

  setBiometricEnabled: async (enabled) => {
    if (enabled) {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !isEnrolled) {
        return false;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Enable WhatsApp Pro App Lock',
        cancelLabel: 'Cancel',
      });
      if (!result.success) return false;
    }
    await secureStorage.setItem(BIOMETRIC_PREF_KEY, enabled ? 'true' : 'false');
    set({ biometricEnabled: enabled, isBiometricLocked: false });
    return true;
  },

  unlockWithBiometrics: async () => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock WhatsApp Pro',
        fallbackLabel: 'Use Passcode',
      });
      if (result.success) {
        set({ isBiometricLocked: false });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  lockIfEnabled: () => {
    if (get().biometricEnabled && get().isAuthenticated) {
      set({ isBiometricLocked: true });
    }
  },
}));

import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { unwrapApiData } from '../types/mobile.types';

const DEFAULT_API_BASE =
  Platform.OS === 'android' && !Device.isDevice
    ? 'http://10.0.2.2:3001/api/v1'
    : 'http://localhost:3001/api/v1';

const ENV_API_BASE =
  process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/+$/, '') || '';

export let API_BASE_URL: string = ENV_API_BASE || DEFAULT_API_BASE;

/** Origin URL without `/api/v1` for Socket.IO connection */
export let SOCKET_BASE_URL: string = API_BASE_URL.replace(/\/api(\/v\d+)?$/, '');

const KEYS = {
  ACCESS_TOKEN: 'whatsapp_pro_access_token',
  REFRESH_TOKEN: 'whatsapp_pro_refresh_token',
  DEVICE_ID: 'whatsapp_pro_device_id',
  API_URL: 'whatsapp_pro_api_url',
} as const;

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        return localStorage.getItem(key);
      }
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    try {
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        localStorage.setItem(key, value);
        return;
      }
      await SecureStore.setItemAsync(key, value);
    } catch {
      // Ignore storage failures in restricted environments
    }
  },
  async deleteItem(key: string): Promise<void> {
    try {
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        localStorage.removeItem(key);
        return;
      }
      await SecureStore.deleteItemAsync(key);
    } catch {
      // Ignore
    }
  },
};

export async function getAccessToken(): Promise<string | null> {
  return secureStorage.getItem(KEYS.ACCESS_TOKEN);
}

export async function getRefreshToken(): Promise<string | null> {
  return secureStorage.getItem(KEYS.REFRESH_TOKEN);
}

export async function saveAuthTokens(accessToken: string, refreshToken?: string | null): Promise<void> {
  await secureStorage.setItem(KEYS.ACCESS_TOKEN, accessToken);
  if (refreshToken) {
    await secureStorage.setItem(KEYS.REFRESH_TOKEN, refreshToken);
  }
}

export async function clearAuthTokens(): Promise<void> {
  await Promise.all([
    secureStorage.deleteItem(KEYS.ACCESS_TOKEN),
    secureStorage.deleteItem(KEYS.REFRESH_TOKEN),
  ]);
}

export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await secureStorage.getItem(KEYS.DEVICE_ID);
  if (existing) return existing;
  const generated = `mob-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  await secureStorage.setItem(KEYS.DEVICE_ID, generated);
  return generated;
}

type UnauthorizedCallback = () => void;
let onUnauthorizedHandler: UnauthorizedCallback | null = null;

export function setOnUnauthorizedHandler(cb: UnauthorizedCallback | null) {
  onUnauthorizedHandler = cb;
}

export const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
  headers: {
    'Content-Type': 'application/json',
  },
});

function normalizeApiBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_API_BASE;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return /\/api(\/v\d+)?$/i.test(withScheme) ? withScheme : `${withScheme}/api/v1`;
}

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

export function getSocketBaseUrl(): string {
  return SOCKET_BASE_URL;
}

export function resolveMediaUrl(url?: string | null): string | null {
  if (!url) return null;
  const localOriginMatch = url.match(
    /^https?:\/\/(?:localhost|127\.0\.0\.1|10\.0\.2\.2)(?::\d+)?(\/.*)$/i,
  );
  if (localOriginMatch?.[1]) {
    return `${getSocketBaseUrl()}${localOriginMatch[1]}`;
  }
  if (/^(https?:|file:|content:|data:)/i.test(url)) return url;
  if (url.startsWith('/')) return `${getSocketBaseUrl()}${url}`;
  return url;
}

export async function setApiBaseUrl(rawUrl: string): Promise<string> {
  const next = normalizeApiBaseUrl(rawUrl);
  API_BASE_URL = next;
  SOCKET_BASE_URL = next.replace(/\/api(\/v\d+)?$/, '');
  api.defaults.baseURL = next;
  await secureStorage.setItem(KEYS.API_URL, next);
  return next;
}

export async function hydrateApiBaseUrl(): Promise<string> {
  const saved = await secureStorage.getItem(KEYS.API_URL);
  if (saved) {
    const next = normalizeApiBaseUrl(saved);
    const isStaleLocalOrQuickTunnel =
      /^https?:\/\/(?:localhost|127\.0\.0\.1|10\.0\.2\.2)(?::\d+)?/i.test(next) ||
      (/\.trycloudflare\.com/i.test(next) &&
        Boolean(ENV_API_BASE) &&
        next !== normalizeApiBaseUrl(ENV_API_BASE));

    if (ENV_API_BASE && isStaleLocalOrQuickTunnel) {
      const upgraded = normalizeApiBaseUrl(ENV_API_BASE);
      API_BASE_URL = upgraded;
      SOCKET_BASE_URL = upgraded.replace(/\/api(\/v\d+)?$/, '');
      api.defaults.baseURL = upgraded;
      await secureStorage.setItem(KEYS.API_URL, upgraded);
      return API_BASE_URL;
    }

    API_BASE_URL = next;
    SOCKET_BASE_URL = next.replace(/\/api(\/v\d+)?$/, '');
    api.defaults.baseURL = next;
  }
  return API_BASE_URL;
}

let isRefreshing = false;
let refreshQueue: Array<{
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}> = [];

function processRefreshQueue(error: unknown, token: string | null) {
  refreshQueue.forEach((p) => {
    if (error || !token) {
      p.reject(error);
    } else {
      p.resolve(token);
    }
  });
  refreshQueue = [];
}

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const [token, deviceId] = await Promise.all([getAccessToken(), getOrCreateDeviceId()]);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (deviceId) {
    config.headers['X-Device-Id'] = deviceId;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    if (!originalRequest || error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }

    const requestUrl = originalRequest.url || '';
    if (requestUrl.includes('/auth/refresh') || requestUrl.includes('/auth/verify-otp') || requestUrl.includes('/auth/login')) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        refreshQueue.push({ resolve, reject });
      }).then((newToken) => {
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      });
    }

    originalRequest._retry = true;
    isRefreshing = true;

    try {
      const refreshToken = await getRefreshToken();
      if (!refreshToken) {
        throw new Error('No refresh token available');
      }
      const res = await axios.post(`${getApiBaseUrl()}/auth/refresh`, {
        refresh_token: refreshToken,
      });
      const payload = unwrapApiData<{ accessToken?: string; access_token?: string; refreshToken?: string; refresh_token?: string }>(
        res.data,
      );
      const nextAccess = payload.accessToken ?? payload.access_token;
      const nextRefresh = payload.refreshToken ?? payload.refresh_token;
      if (!nextAccess) {
        throw new Error('Invalid refresh response');
      }
      await saveAuthTokens(nextAccess, nextRefresh);
      processRefreshQueue(null, nextAccess);
      originalRequest.headers.Authorization = `Bearer ${nextAccess}`;
      return api(originalRequest);
    } catch (refreshError) {
      processRefreshQueue(refreshError, null);
      await clearAuthTokens();
      onUnauthorizedHandler?.();
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  },
);

export default api;

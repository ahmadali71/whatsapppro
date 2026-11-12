import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

export interface ApiEnvelope<T = unknown> {
  success?: boolean;
  data?: T;
  message?: string;
}

const API_BASE_URL = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/+$/, '');

export function getApiOrigin(): string {
  const explicitSocket = import.meta.env.VITE_SOCKET_URL?.trim();
  if (explicitSocket) {
    return explicitSocket.replace(/\/+$/, '');
  }
  const explicitApi = import.meta.env.VITE_API_URL?.trim();
  if (explicitApi && /^https?:\/\//i.test(explicitApi)) {
    return explicitApi.replace(/\/api(?:\/v\d+)?\/?$/i, '').replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return '';
}

export const API_ORIGIN = getApiOrigin();

/**
 * Resolves relative `/uploads/...` media paths and rewrites legacy localhost/loopback
 * upload URLs onto the active API origin so media loads on both same-origin live
 * deployments and cross-origin Vercel hosts.
 */
export function resolveMediaUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (/^(blob:|data:)/i.test(trimmed)) return trimmed;

  const legacyUploadsMatch = trimmed.match(
    /^https?:\/\/(?:localhost|127\.0\.0\.1|10\.0\.2\.2)(?::\d+)?(\/uploads\/.*)$/i,
  );
  if (legacyUploadsMatch) {
    return `${API_ORIGIN}${legacyUploadsMatch[1]}`;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith('/')) {
    return `${API_ORIGIN}${trimmed}`;
  }

  return `${API_ORIGIN}/${trimmed}`;
}

const ACCESS_TOKEN_KEY = 'wp_access_token';
const REFRESH_TOKEN_KEY = 'wp_refresh_token';
const DEVICE_ID_KEY = 'wp_device_id';

export function getOrCreateDeviceId(): string {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

export function getStoredTokens() {
  return {
    accessToken: localStorage.getItem(ACCESS_TOKEN_KEY),
    refreshToken: localStorage.getItem(REFRESH_TOKEN_KEY),
  };
}

export function setStoredTokens(accessToken: string | null, refreshToken: string | null) {
  if (accessToken) {
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  } else {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
  }
  if (refreshToken) {
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  } else {
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  }
}

export function clearStoredTokens() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

let refreshPromise: Promise<string> | null = null;
let onUnauthorizedCallback: (() => void) | null = null;

export function registerUnauthorizedHandler(cb: () => void) {
  onUnauthorizedCallback = cb;
}

function getTokenExpMs(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function setAuthorizationHeader(
  headers: InternalAxiosRequestConfig['headers'] | undefined,
  token: string,
) {
  if (!headers) return;
  const hdrs = headers as unknown as {
    set?: (name: string, value: string) => void;
    Authorization?: string;
  };
  if (typeof hdrs.set === 'function') {
    hdrs.set('Authorization', `Bearer ${token}`);
  } else {
    hdrs.Authorization = `Bearer ${token}`;
  }
}

async function refreshAccessToken(): Promise<string> {
  if (refreshPromise) {
    return refreshPromise;
  }

  const { refreshToken } = getStoredTokens();
  if (!refreshToken) {
    clearStoredTokens();
    onUnauthorizedCallback?.();
    throw new Error('Session expired');
  }

  refreshPromise = (async () => {
    try {
      const res = await axios.post(
        `${API_BASE_URL}/auth/refresh`,
        { refresh_token: refreshToken },
        { timeout: 15000 },
      );
      const payload = unwrapData<{
        accessToken?: string;
        refreshToken?: string;
        access_token?: string;
        refresh_token?: string;
      }>(res.data);

      const newAccess = payload.accessToken || payload.access_token;
      const newRefresh = payload.refreshToken || payload.refresh_token || refreshToken;

      if (!newAccess) {
        throw new Error('Refresh response missing access token');
      }

      setStoredTokens(newAccess, newRefresh);
      return newAccess;
    } catch (err) {
      clearStoredTokens();
      onUnauthorizedCallback?.();
      throw err;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const url = config.url || '';
  const isAuthEndpoint =
    url.includes('/auth/refresh') ||
    url.includes('/auth/login') ||
    url.includes('/auth/verify-otp') ||
    url.includes('/auth/send-otp') ||
    url.includes('/auth/register');

  if (!isAuthEndpoint) {
    const { accessToken, refreshToken } = getStoredTokens();
    const expMs = accessToken ? getTokenExpMs(accessToken) : null;
    const isExpiringSoon =
      !accessToken || (expMs !== null && expMs - Date.now() < 60_000);

    if (refreshPromise) {
      await refreshPromise;
    } else if (isExpiringSoon && refreshToken) {
      await refreshAccessToken();
    }
  }

  const { accessToken: latestToken } = getStoredTokens();
  if (latestToken && config.headers) {
    setAuthorizationHeader(config.headers, latestToken);
  }
  if (config.headers) {
    const hdrs = config.headers as unknown as {
      set?: (name: string, value: string) => void;
    } & Record<string, unknown>;
    if (typeof hdrs.set === 'function') {
      hdrs.set('X-Device-Id', getOrCreateDeviceId());
    } else {
      hdrs['X-Device-Id'] = getOrCreateDeviceId();
    }
  }
  if (config.data instanceof FormData && config.headers) {
    const hdrs = config.headers as unknown as { delete?: (name: string) => void } & Record<
      string,
      unknown
    >;
    if (typeof hdrs.delete === 'function') {
      hdrs.delete('Content-Type');
    } else {
      delete hdrs['Content-Type'];
    }
  }
  return config;
});

interface RetryConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryConfig | undefined;
    if (!originalRequest) return Promise.reject(error);

    const status = error.response?.status;
    const isAuthRefresh = originalRequest.url?.includes('/auth/refresh');
    const isAuthLogin =
      originalRequest.url?.includes('/auth/login') ||
      originalRequest.url?.includes('/auth/verify-otp') ||
      originalRequest.url?.includes('/auth/send-otp') ||
      originalRequest.url?.includes('/auth/register');

    if (status === 401 && !originalRequest._retry && !isAuthRefresh && !isAuthLogin) {
      originalRequest._retry = true;
      try {
        const newAccess = await refreshAccessToken();
        setAuthorizationHeader(originalRequest.headers, newAccess);
        return api(originalRequest);
      } catch (refreshError) {
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  },
);

export function unwrapData<T>(raw: unknown): T {
  if (raw && typeof raw === 'object' && 'data' in raw && (raw as ApiEnvelope<T>).data !== undefined) {
    return (raw as ApiEnvelope<T>).data as T;
  }
  return raw as T;
}

export function extractErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string | string[]; error?: string } | undefined;
    if (data?.message) {
      return Array.isArray(data.message) ? data.message.join(', ') : data.message;
    }
    if (data?.error) return data.error;
    if (error.message) return error.message;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

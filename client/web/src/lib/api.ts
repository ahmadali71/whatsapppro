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

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (err: unknown) => void;
}> = [];

let onUnauthorizedCallback: (() => void) | null = null;

export function registerUnauthorizedHandler(cb: () => void) {
  onUnauthorizedCallback = cb;
}

function processQueue(error: unknown, token: string | null = null) {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else if (token) {
      prom.resolve(token);
    }
  });
  failedQueue = [];
}

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const { accessToken } = getStoredTokens();
  if (accessToken && config.headers) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  if (config.headers) {
    config.headers['X-Device-Id'] = getOrCreateDeviceId();
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
      const { refreshToken } = getStoredTokens();
      if (!refreshToken) {
        clearStoredTokens();
        onUnauthorizedCallback?.();
        return Promise.reject(error);
      }

      if (isRefreshing) {
        return new Promise<string>((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((newToken) => {
          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
          }
          return api(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const res = await axios.post(`${API_BASE_URL}/auth/refresh`, {
          refresh_token: refreshToken,
        });
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
        processQueue(null, newAccess);

        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${newAccess}`;
        }
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        clearStoredTokens();
        onUnauthorizedCallback?.();
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
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

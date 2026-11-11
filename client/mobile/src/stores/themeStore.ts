import { create } from 'zustand';
import { FontSize, ThemePreference } from '@whatsapp-pro/shared-types';
import api, { secureStorage } from '../services/api';
import { unwrapApiData } from '../types/mobile.types';

const THEME_STORAGE_KEY = 'whatsapp_pro_theme_prefs';

interface ThemeState {
  themePreference: ThemePreference;
  fontSize: FontSize;
  wallpaper: string | null;
  enterToSend: boolean;
  mediaAutoDownloadWifi: boolean;
  mediaAutoDownloadCellular: boolean;
  backupEnabled: boolean;
  backupFrequency: string;
  isLoaded: boolean;

  hydrateTheme: () => Promise<void>;
  syncFromServer: () => Promise<void>;
  setThemePreference: (pref: ThemePreference) => Promise<void>;
  setFontSize: (size: FontSize) => Promise<void>;
  setWallpaper: (wallpaper: string | null) => Promise<void>;
  updateChatSettings: (patch: Partial<{
    theme: ThemePreference;
    fontSize: FontSize;
    wallpaper: string | null;
    enterToSend: boolean;
    mediaAutoDownloadWifi: boolean;
    mediaAutoDownloadCellular: boolean;
    backupEnabled: boolean;
    backupFrequency: string;
  }>) => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  themePreference: ThemePreference.SYSTEM,
  fontSize: FontSize.MEDIUM,
  wallpaper: null,
  enterToSend: false,
  mediaAutoDownloadWifi: true,
  mediaAutoDownloadCellular: false,
  backupEnabled: false,
  backupFrequency: 'WEEKLY',
  isLoaded: false,

  hydrateTheme: async () => {
    try {
      const raw = await secureStorage.getItem(THEME_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        set({
          themePreference: parsed.themePreference ?? ThemePreference.SYSTEM,
          fontSize: parsed.fontSize ?? FontSize.MEDIUM,
          wallpaper: parsed.wallpaper ?? null,
          enterToSend: Boolean(parsed.enterToSend),
          mediaAutoDownloadWifi: parsed.mediaAutoDownloadWifi ?? true,
          mediaAutoDownloadCellular: Boolean(parsed.mediaAutoDownloadCellular),
          backupEnabled: Boolean(parsed.backupEnabled),
          backupFrequency: parsed.backupFrequency ?? 'WEEKLY',
        });
      }
    } catch {
      // ignore
    } finally {
      set({ isLoaded: true });
    }
  },

  syncFromServer: async () => {
    try {
      const res = await api.get('/settings/chat');
      const data = unwrapApiData<Record<string, any>>(res.data);
      if (!data) return;
      const next = {
        themePreference: (data.theme ?? get().themePreference) as ThemePreference,
        fontSize: (data.fontSize ?? data.font_size ?? get().fontSize) as FontSize,
        wallpaper: (data.wallpaper ?? get().wallpaper) as string | null,
        enterToSend: Boolean(data.enterToSend ?? data.enter_to_send ?? get().enterToSend),
        mediaAutoDownloadWifi: Boolean(
          data.mediaAutoDownloadWifi ?? data.media_auto_download_wifi ?? get().mediaAutoDownloadWifi,
        ),
        mediaAutoDownloadCellular: Boolean(
          data.mediaAutoDownloadCellular ??
            data.media_auto_download_cellular ??
            get().mediaAutoDownloadCellular,
        ),
        backupEnabled: Boolean(data.backupEnabled ?? data.backup_enabled ?? get().backupEnabled),
        backupFrequency: String(data.backupFrequency ?? data.backup_frequency ?? get().backupFrequency),
      };
      set(next);
      await secureStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore if offline
    }
  },

  setThemePreference: async (themePreference) => {
    await get().updateChatSettings({ theme: themePreference });
  },

  setFontSize: async (fontSize) => {
    await get().updateChatSettings({ fontSize });
  },

  setWallpaper: async (wallpaper) => {
    await get().updateChatSettings({ wallpaper });
  },

  updateChatSettings: async (patch) => {
    const prev = get();
    const updated = {
      themePreference: patch.theme ?? prev.themePreference,
      fontSize: patch.fontSize ?? prev.fontSize,
      wallpaper: patch.wallpaper !== undefined ? patch.wallpaper : prev.wallpaper,
      enterToSend: patch.enterToSend ?? prev.enterToSend,
      mediaAutoDownloadWifi: patch.mediaAutoDownloadWifi ?? prev.mediaAutoDownloadWifi,
      mediaAutoDownloadCellular: patch.mediaAutoDownloadCellular ?? prev.mediaAutoDownloadCellular,
      backupEnabled: patch.backupEnabled ?? prev.backupEnabled,
      backupFrequency: patch.backupFrequency ?? prev.backupFrequency,
    };
    set(updated);
    await secureStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(updated));

    try {
      await api.patch('/settings/chat', {
        theme: updated.themePreference,
        fontSize: updated.fontSize,
        wallpaper: updated.wallpaper,
        enterToSend: updated.enterToSend,
        mediaAutoDownloadWifi: updated.mediaAutoDownloadWifi,
        mediaAutoDownloadCellular: updated.mediaAutoDownloadCellular,
        backupEnabled: updated.backupEnabled,
        backupFrequency: updated.backupFrequency,
      });
    } catch {
      // Optimistic local persistence remains active
    }
  },
}));

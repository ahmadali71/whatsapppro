import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { FontSize, ThemePreference } from '@whatsapp-pro/shared-types';

export interface WallpaperOption {
  id: string;
  label: string;
  lightBg: string;
  darkBg: string;
  pattern?: string;
}

export const WALLPAPER_PRESETS: WallpaperOption[] = [
  {
    id: 'default',
    label: 'Classic Doodle',
    lightBg: '#EFEAE2',
    darkBg: '#0B141A',
    pattern: 'radial-gradient(circle at 1px 1px, rgba(0,0,0,0.06) 1px, transparent 0)',
  },
  {
    id: 'emerald',
    label: 'Emerald Mist',
    lightBg: '#E4F3EC',
    darkBg: '#0A1C16',
  },
  {
    id: 'ocean',
    label: 'Deep Ocean',
    lightBg: '#E6F0F8',
    darkBg: '#0B1926',
  },
  {
    id: 'sunset',
    label: 'Warm Sand',
    lightBg: '#F6EDE4',
    darkBg: '#1B1512',
  },
  {
    id: 'slate',
    label: 'Minimal Slate',
    lightBg: '#F1F5F9',
    darkBg: '#111827',
  },
];

interface ThemeState {
  theme: ThemePreference;
  resolvedTheme: 'light' | 'dark';
  wallpaper: string;
  customWallpaperUrl: string | null;
  fontSize: FontSize;
  enterToSend: boolean;
  mediaAutoDownloadWifi: boolean;
  mediaAutoDownloadCellular: boolean;
  setTheme: (theme: ThemePreference) => void;
  setWallpaper: (wallpaper: string, customUrl?: string | null) => void;
  setFontSize: (fontSize: FontSize) => void;
  setEnterToSend: (enterToSend: boolean) => void;
  setMediaAutoDownload: (wifi: boolean, cellular: boolean) => void;
  applyThemeToDom: () => void;
}

function resolveSystemTheme(pref: ThemePreference): 'light' | 'dark' {
  if (pref === ThemePreference.DARK) return 'dark';
  if (pref === ThemePreference.LIGHT) return 'light';
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: ThemePreference.SYSTEM,
      resolvedTheme: resolveSystemTheme(ThemePreference.SYSTEM),
      wallpaper: 'default',
      customWallpaperUrl: null,
      fontSize: FontSize.MEDIUM,
      enterToSend: true,
      mediaAutoDownloadWifi: true,
      mediaAutoDownloadCellular: false,

      setTheme: (theme) => {
        const resolved = resolveSystemTheme(theme);
        set({ theme, resolvedTheme: resolved });
        get().applyThemeToDom();
      },

      setWallpaper: (wallpaper, customUrl = null) => {
        set({ wallpaper, customWallpaperUrl: customUrl ?? get().customWallpaperUrl });
      },

      setFontSize: (fontSize) => set({ fontSize }),
      setEnterToSend: (enterToSend) => set({ enterToSend }),
      setMediaAutoDownload: (mediaAutoDownloadWifi, mediaAutoDownloadCellular) =>
        set({ mediaAutoDownloadWifi, mediaAutoDownloadCellular }),

      applyThemeToDom: () => {
        const resolved = resolveSystemTheme(get().theme);
        set({ resolvedTheme: resolved });
        if (typeof document !== 'undefined') {
          const root = document.documentElement;
          if (resolved === 'dark') {
            root.classList.add('dark');
          } else {
            root.classList.remove('dark');
          }
        }
      },
    }),
    {
      name: 'wp-theme-store',
    },
  ),
);

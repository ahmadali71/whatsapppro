import React, { createContext, useContext } from 'react';
import { useColorScheme } from 'react-native';
import { FontSize, ThemePreference } from '@whatsapp-pro/shared-types';
import { useThemeStore } from '../stores/themeStore';

export interface ThemePalette {
  isDark: boolean;
  primary: string;
  primaryDark: string;
  accent: string;
  background: string;
  surface: string;
  surfaceElevated: string;
  card: string;
  headerBg: string;
  headerText: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  divider: string;
  incomingBubble: string;
  outgoingBubble: string;
  chatWallpaper: string;
  inputBg: string;
  badgeBg: string;
  badgeText: string;
  online: string;
  danger: string;
  warning: string;
  info: string;
  tickDefault: string;
  tickRead: string;
  tabBarBg: string;
  tabBarInactive: string;
  overlay: string;
  fontSizeScale: number;
}

export const LightPalette: Omit<ThemePalette, 'isDark' | 'fontSizeScale'> = {
  primary: '#00A884',
  primaryDark: '#075E54',
  accent: '#25D366',
  background: '#FFFFFF',
  surface: '#F0F2F5',
  surfaceElevated: '#FFFFFF',
  card: '#FFFFFF',
  headerBg: '#075E54',
  headerText: '#FFFFFF',
  text: '#111B21',
  textSecondary: '#54656F',
  textMuted: '#8696A0',
  border: '#E9EDEF',
  divider: '#EFEFEF',
  incomingBubble: '#FFFFFF',
  outgoingBubble: '#D9FDD3',
  chatWallpaper: '#EFEAE2',
  inputBg: '#FFFFFF',
  badgeBg: '#25D366',
  badgeText: '#FFFFFF',
  online: '#25D366',
  danger: '#EA0038',
  warning: '#F59E0B',
  info: '#34B7F1',
  tickDefault: '#667781',
  tickRead: '#53BDEB',
  tabBarBg: '#FFFFFF',
  tabBarInactive: '#667781',
  overlay: 'rgba(11, 20, 26, 0.55)',
};

export const DarkPalette: Omit<ThemePalette, 'isDark' | 'fontSizeScale'> = {
  primary: '#00A884',
  primaryDark: '#1F2C34',
  accent: '#00A884',
  background: '#0B141A',
  surface: '#111B21',
  surfaceElevated: '#202C33',
  card: '#111B21',
  headerBg: '#1F2C34',
  headerText: '#E9EDEF',
  text: '#E9EDEF',
  textSecondary: '#8696A0',
  textMuted: '#667781',
  border: '#222E35',
  divider: '#1F2C34',
  incomingBubble: '#202C33',
  outgoingBubble: '#005C4B',
  chatWallpaper: '#0B141A',
  inputBg: '#202C33',
  badgeBg: '#00A884',
  badgeText: '#111B21',
  online: '#00A884',
  danger: '#F15C6D',
  warning: '#FBBF24',
  info: '#53BDEB',
  tickDefault: '#8696A0',
  tickRead: '#53BDEB',
  tabBarBg: '#111B21',
  tabBarInactive: '#8696A0',
  overlay: 'rgba(0, 0, 0, 0.72)',
};

const ThemeContext = createContext<ThemePalette>({
  ...LightPalette,
  isDark: false,
  fontSizeScale: 1,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const { themePreference, fontSize, wallpaper } = useThemeStore();

  const isDark =
    themePreference === ThemePreference.DARK ||
    (themePreference === ThemePreference.SYSTEM && systemScheme === 'dark');

  const base = isDark ? DarkPalette : LightPalette;
  const fontSizeScale =
    fontSize === FontSize.SMALL ? 0.9 : fontSize === FontSize.LARGE ? 1.15 : 1;

  const value: ThemePalette = {
    ...base,
    isDark,
    fontSizeScale,
    chatWallpaper: wallpaper || base.chatWallpaper,
  };

  return React.createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme(): ThemePalette {
  return useContext(ThemeContext);
}

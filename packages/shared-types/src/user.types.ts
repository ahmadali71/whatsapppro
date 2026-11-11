export enum UserRole {
  USER = 'USER',
  ADMIN = 'ADMIN',
}

export enum DeviceType {
  WEB = 'WEB',
  MOBILE_IOS = 'MOBILE_IOS',
  MOBILE_ANDROID = 'MOBILE_ANDROID',
  DESKTOP = 'DESKTOP',
}

export enum Platform {
  WEB = 'WEB',
  IOS = 'IOS',
  ANDROID = 'ANDROID',
  WINDOWS = 'WINDOWS',
  MACOS = 'MACOS',
  LINUX = 'LINUX',
}

export enum PrivacyVisibility {
  ALL = 'ALL',
  CONTACTS = 'CONTACTS',
  SELECTED = 'SELECTED',
  NOBODY = 'NOBODY',
}

export enum ThemePreference {
  LIGHT = 'LIGHT',
  DARK = 'DARK',
  SYSTEM = 'SYSTEM',
}

export enum FontSize {
  SMALL = 'SMALL',
  MEDIUM = 'MEDIUM',
  LARGE = 'LARGE',
}

export interface User {
  id: string;
  phoneNumber: string;
  countryCode: string;
  username?: string | null;
  displayName: string;
  about?: string | null;
  avatarUrl?: string | null;
  role: UserRole;
  isVerified: boolean;
  isActive: boolean;
  isBanned: boolean;
  twoFactorEnabled: boolean;
  recoveryEmail?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  deletedAt?: string | Date | null;
}

export interface UserProfile {
  id: string;
  userId: string;
  lastSeen?: string | Date | null;
  isOnline: boolean;
  isTypingInConversationId?: string | null;
  pushNotificationToken?: string | null;
  platform?: string | null;
  appVersion?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface UserDevice {
  id: string;
  userId: string;
  deviceId: string;
  deviceName: string;
  deviceType: DeviceType | string;
  pushToken?: string | null;
  platform: Platform | string;
  isActive: boolean;
  lastActiveAt: string | Date;
  createdAt: string | Date;
}

export interface Contact {
  id: string;
  ownerId: string;
  contactId: string;
  nickname?: string | null;
  isFavorite: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
  contactUser?: User;
}

export interface PrivacySettings {
  id: string;
  userId: string;
  lastSeenVisibility: PrivacyVisibility;
  onlineVisibility: PrivacyVisibility;
  profilePhotoVisibility: PrivacyVisibility;
  aboutVisibility: PrivacyVisibility;
  statusVisibility: PrivacyVisibility;
  readReceiptsEnabled: boolean;
  disappearingMessagesDefault?: number | null;
  updatedAt: string | Date;
}

export interface ChatSettings {
  id: string;
  userId: string;
  fontSize: FontSize;
  enterToSend: boolean;
  mediaAutoDownloadWifi: boolean;
  mediaAutoDownloadCellular: boolean;
  theme: ThemePreference;
  wallpaper?: string | null;
  backupEnabled: boolean;
  backupFrequency?: string | null;
  updatedAt: string | Date;
}

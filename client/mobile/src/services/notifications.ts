import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { NavigationContainerRef } from '@react-navigation/native';
import api, { getOrCreateDeviceId } from './api';
import { RootStackParamList } from '../types/mobile.types';
import { CallType } from '@whatsapp-pro/shared-types';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export interface NotificationDeepLinkData {
  type?: 'MESSAGE' | 'CALL' | 'GROUP' | 'STATUS';
  conversationId?: string;
  callId?: string;
  callType?: CallType;
  title?: string;
  callerName?: string;
  userId?: string;
}

class MobileNotificationsService {
  private navigationRef: NavigationContainerRef<RootStackParamList> | null = null;
  private foregroundSub: Notifications.Subscription | null = null;
  private responseSub: Notifications.Subscription | null = null;

  setNavigationRef(ref: NavigationContainerRef<RootStackParamList> | null) {
    this.navigationRef = ref;
  }

  /**
   * Registers for FCM/APNs push notifications and uploads token via `PATCH /users/me`.
   */
  async registerAndSyncPushToken(): Promise<string | null> {
    if (Platform.OS === 'web') return null;

    try {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('messages', {
          name: 'Messages',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#00A884',
        });
        await Notifications.setNotificationChannelAsync('calls', {
          name: 'Incoming Calls',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 500, 300, 500],
          lightColor: '#25D366',
        });
      }

      if (!Device.isDevice) {
        return null;
      }

      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      if (finalStatus !== 'granted') {
        return null;
      }

      const projectId =
        Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

      let token: string | null = null;
      try {
        const deviceToken = await Notifications.getDevicePushTokenAsync();
        token = typeof deviceToken.data === 'string' ? deviceToken.data : JSON.stringify(deviceToken.data);
      } catch {
        const expoToken = await Notifications.getExpoPushTokenAsync(
          projectId ? { projectId } : undefined,
        );
        token = expoToken.data;
      }

      if (token) {
        await api.patch('/users/me', {
          push_notification_token: token,
          platform: Platform.OS.toUpperCase(),
          app_version: Constants.expoConfig?.version ?? '1.0.0',
        });
      }

      return token;
    } catch {
      return null;
    }
  }

  /**
   * Attaches foreground & background tap listeners and checks cold-start notification.
   */
  setupListeners(onIncomingCallNotification?: (data: NotificationDeepLinkData) => void): () => void {
    this.cleanupListeners();

    this.foregroundSub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as NotificationDeepLinkData | undefined;
      if (data?.type === 'CALL' && onIncomingCallNotification) {
        onIncomingCallNotification(data);
      }
    });

    this.responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as NotificationDeepLinkData | undefined;
      if (data) {
        this.handleDeepLink(data);
      }
    });

    // Cold start check
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        const data = response?.notification.request.content.data as NotificationDeepLinkData | undefined;
        if (data) {
          setTimeout(() => this.handleDeepLink(data), 400);
        }
      })
      .catch(() => {});

    return () => this.cleanupListeners();
  }

  handleDeepLink(data: NotificationDeepLinkData) {
    if (!this.navigationRef?.isReady()) return;

    if (data.callId) {
      this.navigationRef.navigate('ActiveCall', {
        callId: data.callId,
        conversationId: data.conversationId,
        callType: data.callType ?? CallType.AUDIO,
        peerName: data.callerName ?? 'Caller',
        isCaller: false,
      });
      return;
    }

    if (data.conversationId) {
      this.navigationRef.navigate('ChatRoom', {
        conversationId: data.conversationId,
        title: data.title,
      });
      return;
    }

    if (data.userId && data.type === 'STATUS') {
      this.navigationRef.navigate('StatusViewer', { userId: data.userId });
    }
  }

  cleanupListeners() {
    this.foregroundSub?.remove();
    this.responseSub?.remove();
    this.foregroundSub = null;
    this.responseSub = null;
  }
}

export const notificationsService = new MobileNotificationsService();
export default notificationsService;

import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { PrismaService } from '../prisma/prisma.service';

interface ApnNotificationInstance {
  expiry: number;
  sound: string;
  alert: { title: string; body: string };
  payload: Record<string, unknown>;
  topic: string;
}

interface ApnProviderInstance {
  send(
    notification: ApnNotificationInstance,
    recipients: string | string[],
  ): Promise<{ sent: unknown[]; failed: Array<{ response?: unknown }> }>;
}

interface ApnModule {
  Provider: new (options: Record<string, unknown>) => ApnProviderInstance;
  Notification: new () => ApnNotificationInstance;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const apn = require('@parse/node-apn') as ApnModule;

export interface PushNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private firebaseApp: admin.app.App | null = null;
  private apnProvider: ApnProviderInstance | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    this.initializeFirebase();
    this.initializeApns();
  }

  private initializeFirebase(): void {
    const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
    const clientEmail = this.configService.get<string>('FIREBASE_CLIENT_EMAIL');
    const privateKeyRaw = this.configService.get<string>('FIREBASE_PRIVATE_KEY');

    const hasPlaceholders =
      !projectId ||
      !clientEmail ||
      !privateKeyRaw ||
      projectId.includes('your-firebase-project-id') ||
      privateKeyRaw.includes('YOUR_PRIVATE_KEY');

    if (hasPlaceholders) {
      this.logger.warn(
        'Firebase Admin SDK not initialized: FIREBASE_* env vars are missing or placeholders',
      );
      return;
    }

    try {
      const privateKey = privateKeyRaw.replace(/\\n/g, '\n');

      if (admin.apps.length > 0 && admin.apps[0]) {
        this.firebaseApp = admin.apps[0];
      } else {
        this.firebaseApp = admin.initializeApp({
          credential: admin.credential.cert({
            projectId,
            clientEmail,
            privateKey,
          }),
        });
      }
      this.logger.log('Firebase Admin SDK initialized for FCM push notifications');
    } catch (error) {
      this.logger.warn(
        `Failed to initialize Firebase Admin SDK: ${(error as Error).message}`,
      );
    }
  }

  private initializeApns(): void {
    const keyId = this.configService.get<string>('APNS_KEY_ID');
    const teamId = this.configService.get<string>('APNS_TEAM_ID');
    const key = this.configService.get<string>('APNS_KEY');
    const keyPath = this.configService.get<string>('APNS_KEY_PATH');

    if (!keyId || !teamId || (!key && !keyPath)) {
      this.logger.debug(
        'APNs provider not initialized: APNS_KEY_ID / APNS_TEAM_ID / APNS_KEY(_PATH) not configured',
      );
      return;
    }

    try {
      const production =
        this.configService.get<string>('NODE_ENV', 'development') === 'production';

      this.apnProvider = new apn.Provider({
        token: {
          key: key ? key.replace(/\\n/g, '\n') : (keyPath as string),
          keyId,
          teamId,
        },
        production,
      });
      this.logger.log('APNs provider initialized for iOS push notifications');
    } catch (error) {
      this.logger.warn(
        `Failed to initialize APNs provider: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Create a persistent notification record and dispatch FCM/APNs push notifications
   * to all active registered devices for the user.
   */
  async sendPushNotification(
    userId: string,
    title: string,
    body: string,
    data: Record<string, unknown> = {},
  ) {
    const normalizedData: Record<string, unknown> = {
      ...data,
      conversationId:
        typeof data.conversationId === 'string' ? data.conversationId : '',
    };

    const notificationType =
      typeof normalizedData.type === 'string' ? normalizedData.type : 'GENERAL';

    const notificationRecord = await this.prisma.notification.create({
      data: {
        userId,
        type: notificationType,
        title,
        body,
        data: normalizedData as any,
        sentAt: new Date(),
      },
    });

    const [devices, profile] = await Promise.all([
      this.prisma.userDevice.findMany({
        where: {
          userId,
          isActive: true,
          pushToken: { not: null },
        },
        select: {
          pushToken: true,
          platform: true,
        },
      }),
      this.prisma.userProfile.findUnique({
        where: { userId },
        select: {
          pushNotificationToken: true,
          platform: true,
        },
      }),
    ]);

    const targets: Array<{ token: string; platform: string }> = [];
    const seenTokens = new Set<string>();

    for (const device of devices) {
      if (device.pushToken && !seenTokens.has(device.pushToken)) {
        seenTokens.add(device.pushToken);
        targets.push({ token: device.pushToken, platform: device.platform });
      }
    }

    if (
      profile?.pushNotificationToken &&
      !seenTokens.has(profile.pushNotificationToken)
    ) {
      seenTokens.add(profile.pushNotificationToken);
      targets.push({
        token: profile.pushNotificationToken,
        platform: profile.platform ?? 'ANDROID',
      });
    }

    await Promise.allSettled(
      targets.map(({ token, platform }) => {
        const normalizedPlatform = platform.toUpperCase();
        if (normalizedPlatform === 'IOS' || normalizedPlatform === 'APNS') {
          return this.sendAPNs(token, { title, body, data: normalizedData });
        }
        return this.sendFCM(token, { title, body, data: normalizedData });
      }),
    );

    return notificationRecord;
  }

  /**
   * Send push notification via Firebase Cloud Messaging (FCM).
   */
  async sendFCM(
    token: string,
    notification: PushNotificationPayload,
  ): Promise<string | null> {
    if (!this.firebaseApp) {
      this.logger.debug(
        `Skipping FCM send (Firebase not configured) for token ${token.slice(0, 8)}...`,
      );
      return null;
    }

    const stringifiedData: Record<string, string> = {};
    if (notification.data) {
      for (const [key, value] of Object.entries(notification.data)) {
        if (value !== undefined && value !== null) {
          stringifiedData[key] =
            typeof value === 'string' ? value : JSON.stringify(value);
        }
      }
    }

    if (!stringifiedData.conversationId) {
      stringifiedData.conversationId = '';
    }

    try {
      const messageId = await this.firebaseApp.messaging().send({
        token,
        notification: {
          title: notification.title,
          body: notification.body,
        },
        data: stringifiedData,
        android: {
          priority: 'high',
          notification: {
            channelId: 'whatsapp_pro_default',
            sound: 'default',
          },
        },
        webpush: {
          notification: {
            title: notification.title,
            body: notification.body,
          },
          fcmOptions: {
            link: stringifiedData.conversationId
              ? `/chats/${stringifiedData.conversationId}`
              : '/',
          },
        },
      });
      return messageId;
    } catch (error) {
      this.logger.warn(
        `FCM delivery failed for token ${token.slice(0, 8)}...: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Send push notification via Apple Push Notification service (APNs).
   */
  async sendAPNs(
    token: string,
    notification: PushNotificationPayload,
  ): Promise<boolean> {
    if (!this.apnProvider) {
      this.logger.debug(
        `Skipping APNs send (APNs not configured) for token ${token.slice(0, 8)}...`,
      );
      return false;
    }

    try {
      const apnNote = new apn.Notification();
      apnNote.expiry = Math.floor(Date.now() / 1000) + 3600;
      apnNote.sound = 'default';
      apnNote.alert = {
        title: notification.title,
        body: notification.body,
      };
      apnNote.payload = {
        ...(notification.data ?? {}),
        conversationId:
          typeof notification.data?.conversationId === 'string'
            ? notification.data.conversationId
            : '',
      };
      apnNote.topic = this.configService.get<string>(
        'APNS_BUNDLE_ID',
        'com.whatsapppro.app',
      );

      const result = await this.apnProvider.send(apnNote, token);
      if (result.failed.length > 0) {
        this.logger.warn(
          `APNs delivery failed for token ${token.slice(0, 8)}...: ${JSON.stringify(result.failed[0]?.response)}`,
        );
        return false;
      }
      return true;
    } catch (error) {
      this.logger.warn(
        `APNs error for token ${token.slice(0, 8)}...: ${(error as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Send new message notifications to all recipients with conversationId deep-link metadata.
   */
  async sendNewMessageNotification(
    message: {
      id: string;
      conversationId: string;
      senderId: string;
      content?: string | null;
      messageType?: string;
      isEncrypted?: boolean;
      sender?: { displayName?: string };
    },
    recipientIds: string[],
  ): Promise<void> {
    const senderName = message.sender?.displayName ?? 'New message';
    let body = message.content?.trim() || 'Sent an attachment';

    if (message.isEncrypted) {
      body = 'New encrypted message';
    } else if (message.messageType && message.messageType !== 'TEXT' && !message.content) {
      body = `Sent a ${message.messageType.toLowerCase()}`;
    }

    const targets = recipientIds.filter((id) => id !== message.senderId);
    await Promise.allSettled(
      targets.map((recipientId) =>
        this.sendPushNotification(recipientId, senderName, body, {
          type: 'NEW_MESSAGE',
          conversationId: message.conversationId,
          messageId: message.id,
          senderId: message.senderId,
          messageType: message.messageType ?? 'TEXT',
        }),
      ),
    );
  }

  /**
   * Send incoming call notifications to call recipients with conversationId deep-link metadata.
   */
  async sendCallNotification(
    call: {
      id: string;
      callerId: string;
      callType: string;
      conversationId?: string | null;
      caller?: { displayName?: string };
    },
    recipientIds: string[],
  ): Promise<void> {
    const callerName = call.caller?.displayName ?? 'Someone';
    const mediaLabel = call.callType === 'VIDEO' ? 'video' : 'voice';
    const title = `Incoming ${mediaLabel} call`;
    const body = `${callerName} is calling you`;

    const targets = recipientIds.filter((id) => id !== call.callerId);
    await Promise.allSettled(
      targets.map((recipientId) =>
        this.sendPushNotification(recipientId, title, body, {
          type: 'INCOMING_CALL',
          callId: call.id,
          callerId: call.callerId,
          callType: call.callType,
          conversationId: call.conversationId ?? '',
        }),
      ),
    );
  }

  /**
   * Send group event notifications to active group members except the actor.
   */
  async sendGroupNotification(
    event: string,
    groupId: string,
    excludeUserId?: string,
    extraData: Record<string, unknown> = {},
  ): Promise<void> {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      include: {
        members: {
          where: { isActive: true },
          select: { userId: true },
        },
        conversations: {
          take: 1,
          select: { id: true },
        },
      },
    });

    if (!group) {
      return;
    }

    const conversationId = group.conversations[0]?.id ?? '';
    const title = group.name;
    const body = this.formatGroupEventBody(event, group.name, extraData);

    const recipients = group.members
      .map((m) => m.userId)
      .filter((id) => id !== excludeUserId);

    await Promise.allSettled(
      recipients.map((userId) =>
        this.sendPushNotification(userId, title, body, {
          type: 'GROUP_EVENT',
          event,
          groupId,
          conversationId,
          ...extraData,
        }),
      ),
    );
  }

  private formatGroupEventBody(
    event: string,
    groupName: string,
    extraData: Record<string, unknown>,
  ): string {
    if (typeof extraData.message === 'string') {
      return extraData.message;
    }
    switch (event) {
      case 'GROUP_CREATED':
        return `You were added to "${groupName}"`;
      case 'GROUP_UPDATED':
        return `Group "${groupName}" details were updated`;
      case 'GROUP_MEMBER_ADDED':
        return `New members were added to "${groupName}"`;
      case 'GROUP_MEMBER_REMOVED':
        return `A member left or was removed from "${groupName}"`;
      case 'GROUP_MEMBER_ROLE_UPDATED':
        return `Member role updated in "${groupName}"`;
      default:
        return `Update in "${groupName}"`;
    }
  }

  async markNotificationRead(notificationId: string, userId?: string) {
    const existing = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!existing || (userId && existing.userId !== userId)) {
      throw new NotFoundException('Notification not found');
    }

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });
  }

  async markAllNotificationsRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    return { updatedCount: result.count };
  }

  async getNotifications(userId: string, cursor?: string, limit = 20) {
    const take = Math.min(Math.max(limit, 1), 100);

    const [rows, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        take: take + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notification.count({
        where: { userId, isRead: false },
      }),
    ]);

    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return {
      items,
      nextCursor,
      hasMore,
      unreadCount,
    };
  }
}

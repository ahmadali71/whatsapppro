import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  DisappearingTimeoutPreset,
  UpdatePrivacySettingsDto,
} from './dto/privacy.dto';

const TIMEOUT_SECONDS_MAP: Record<DisappearingTimeoutPreset, number | null> = {
  '24h': 24 * 60 * 60,
  '7d': 7 * 24 * 60 * 60,
  '90d': 90 * 24 * 60 * 60,
  off: null,
};

@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getPrivacySettings(userId: string) {
    let settings = await this.prisma.privacySetting.findUnique({
      where: { userId },
    });

    if (!settings) {
      settings = await this.prisma.privacySetting.create({
        data: { userId },
      });
    }

    return settings;
  }

  async updatePrivacySettings(userId: string, dto: UpdatePrivacySettingsDto) {
    const existing = await this.prisma.privacySetting.findUnique({
      where: { userId },
    });

    const data = {
      ...(dto.lastSeenVisibility !== undefined && {
        lastSeenVisibility: dto.lastSeenVisibility,
      }),
      ...(dto.onlineVisibility !== undefined && {
        onlineVisibility: dto.onlineVisibility,
      }),
      ...(dto.profilePhotoVisibility !== undefined && {
        profilePhotoVisibility: dto.profilePhotoVisibility,
      }),
      ...(dto.aboutVisibility !== undefined && {
        aboutVisibility: dto.aboutVisibility,
      }),
      ...(dto.statusVisibility !== undefined && {
        statusVisibility: dto.statusVisibility,
      }),
      ...(dto.readReceiptsEnabled !== undefined && {
        readReceiptsEnabled: dto.readReceiptsEnabled,
      }),
      ...(dto.disappearingMessagesDefault !== undefined && {
        disappearingMessagesDefault:
          dto.disappearingMessagesDefault === 0 ? null : dto.disappearingMessagesDefault,
      }),
    };

    if (!existing) {
      return this.prisma.privacySetting.create({
        data: { userId, ...data },
      });
    }

    return this.prisma.privacySetting.update({
      where: { userId },
      data,
    });
  }

  async setDisappearingMessages(
    conversationId: string,
    userId: string,
    timeout: DisappearingTimeoutPreset | number | null,
  ) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        members: {
          where: { userId, isActive: true },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (conversation.members.length === 0) {
      throw new ForbiddenException('You are not an active member of this conversation');
    }

    let timeoutSeconds: number | null;
    if (typeof timeout === 'string') {
      if (!(timeout in TIMEOUT_SECONDS_MAP)) {
        throw new BadRequestException('Invalid timeout value; expected 24h, 7d, 90d, or off');
      }
      timeoutSeconds = TIMEOUT_SECONDS_MAP[timeout];
    } else if (typeof timeout === 'number') {
      timeoutSeconds = timeout > 0 ? timeout : null;
    } else {
      timeoutSeconds = null;
    }

    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { disappearingMessagesTimeout: timeoutSeconds },
      select: {
        id: true,
        type: true,
        disappearingMessagesTimeout: true,
        updatedAt: true,
      },
    });

    return updated;
  }

  async deleteDisappearingMessages(): Promise<number> {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        disappearingMessagesTimeout: { not: null, gt: 0 },
      },
      select: {
        id: true,
        disappearingMessagesTimeout: true,
      },
    });

    if (conversations.length === 0) {
      return 0;
    }

    const nowMs = Date.now();
    let totalDeleted = 0;

    for (const conv of conversations) {
      const timeoutSeconds = conv.disappearingMessagesTimeout;
      if (!timeoutSeconds || timeoutSeconds <= 0) continue;

      const cutoff = new Date(nowMs - timeoutSeconds * 1000);
      const result = await this.prisma.message.deleteMany({
        where: {
          conversationId: conv.id,
          createdAt: { lt: cutoff },
        },
      });
      totalDeleted += result.count;
    }

    if (totalDeleted > 0) {
      this.logger.log(`Deleted ${totalDeleted} expired disappearing messages`);
    }
    return totalDeleted;
  }

  async getActiveSessions(userId: string) {
    const now = new Date();
    const sessions = await this.prisma.authenticationSession.findMany({
      where: {
        userId,
        isRevoked: false,
        expiresAt: { gt: now },
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        deviceId: true,
        ipAddress: true,
        userAgent: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Enrich with device names when deviceId matches user_devices
    const deviceIds = sessions.map((s) => s.deviceId).filter((d): d is string => Boolean(d));
    const devices = deviceIds.length
      ? await this.prisma.userDevice.findMany({
          where: { userId, deviceId: { in: deviceIds } },
          select: {
            deviceId: true,
            deviceName: true,
            deviceType: true,
            platform: true,
            lastActiveAt: true,
          },
        })
      : [];

    const deviceMap = new Map(devices.map((d) => [d.deviceId, d]));

    return sessions.map((session) => ({
      ...session,
      device: session.deviceId ? deviceMap.get(session.deviceId) ?? null : null,
    }));
  }

  async revokeSession(userId: string, sessionId: string) {
    const session = await this.prisma.authenticationSession.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.userId !== userId) {
      throw new NotFoundException('Session not found');
    }

    const updated = await this.prisma.authenticationSession.update({
      where: { id: sessionId },
      data: { isRevoked: true },
      select: {
        id: true,
        deviceId: true,
        isRevoked: true,
        updatedAt: true,
      },
    });

    if (session.deviceId) {
      await this.prisma.userDevice.updateMany({
        where: { userId, deviceId: session.deviceId },
        data: { isActive: false },
      });
    }

    return updated;
  }

  async revokeOtherSessions(
    userId: string,
    currentSessionId?: string,
    currentDeviceId?: string,
  ) {
    const where: any = {
      userId,
      isRevoked: false,
    };

    if (currentSessionId) {
      where.id = { not: currentSessionId };
    } else if (currentDeviceId) {
      where.deviceId = { not: currentDeviceId };
    }

    const result = await this.prisma.authenticationSession.updateMany({
      where,
      data: { isRevoked: true },
    });

    return { revokedCount: result.count };
  }
}

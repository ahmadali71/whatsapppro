import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  TriggerBackupDto,
  UpdateChatSettingsDto,
  UpdateNotificationPreferenceDto,
} from './dto/settings.dto';

const NOTIF_PREF_KEY_PREFIX = 'settings:notifications:';
const BACKUP_KEY_PREFIX = 'settings:backup:';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getChatSettings(userId: string) {
    let settings = await this.prisma.chatSetting.findUnique({
      where: { userId },
    });

    if (!settings) {
      settings = await this.prisma.chatSetting.create({
        data: { userId },
      });
    }

    const lastBackupRaw = await this.redis.get(`${BACKUP_KEY_PREFIX}${userId}`);
    return {
      ...settings,
      lastBackup: lastBackupRaw ? JSON.parse(lastBackupRaw) : null,
    };
  }

  async updateChatSettings(userId: string, dto: UpdateChatSettingsDto) {
    const existing = await this.prisma.chatSetting.findUnique({
      where: { userId },
    });

    const resolvedFontSize = dto.fontSize ?? dto.font_size;
    const data = {
      ...(resolvedFontSize !== undefined && { fontSize: resolvedFontSize }),
      ...(dto.enterToSend !== undefined && { enterToSend: dto.enterToSend }),
      ...(dto.mediaAutoDownloadWifi !== undefined && {
        mediaAutoDownloadWifi: dto.mediaAutoDownloadWifi,
      }),
      ...(dto.mediaAutoDownloadCellular !== undefined && {
        mediaAutoDownloadCellular: dto.mediaAutoDownloadCellular,
      }),
      ...(dto.theme !== undefined && { theme: dto.theme }),
      ...(dto.wallpaper !== undefined && { wallpaper: dto.wallpaper }),
      ...(dto.backupEnabled !== undefined && { backupEnabled: dto.backupEnabled }),
      ...(dto.backupFrequency !== undefined && {
        backupFrequency: dto.backupFrequency,
      }),
    };

    if (!existing) {
      return this.prisma.chatSetting.create({
        data: { userId, ...data },
      });
    }

    return this.prisma.chatSetting.update({
      where: { userId },
      data,
    });
  }

  async getNotificationPreferences(userId: string) {
    const memberships = await this.prisma.conversationMember.findMany({
      where: { userId, isActive: true, leftAt: null },
      include: {
        conversation: {
          select: {
            id: true,
            type: true,
            isMuted: true,
            mutedUntil: true,
            group: { select: { id: true, name: true, avatarUrl: true } },
            members: {
              where: { userId: { not: userId }, isActive: true },
              take: 1,
              include: {
                user: {
                  select: { id: true, displayName: true, avatarUrl: true },
                },
              },
            },
          },
        },
      },
    });

    const preferences = await Promise.all(
      memberships.map(async (m) => {
        const prefRaw = await this.redis.get(
          `${NOTIF_PREF_KEY_PREFIX}${userId}:${m.conversationId}`,
        );
        const pref = prefRaw ? JSON.parse(prefRaw) : null;
        const peer = m.conversation.members[0]?.user ?? null;

        return {
          conversationId: m.conversationId,
          type: m.conversation.type,
          title: m.conversation.group?.name ?? peer?.displayName ?? 'Conversation',
          avatarUrl: m.conversation.group?.avatarUrl ?? peer?.avatarUrl ?? null,
          isMuted: pref?.isMuted ?? m.conversation.isMuted,
          mutedUntil: pref?.mutedUntil ?? m.conversation.mutedUntil,
          customSound: pref?.customSound ?? 'default',
          showPreview: pref?.showPreview ?? true,
        };
      }),
    );

    return preferences;
  }

  async updateConversationNotification(
    userId: string,
    conversationId: string,
    dto: UpdateNotificationPreferenceDto,
  ) {
    const membership = await this.prisma.conversationMember.findUnique({
      where: {
        conversationId_userId: { conversationId, userId },
      },
      include: { conversation: true },
    });

    if (!membership || !membership.isActive) {
      throw new ForbiddenException('You are not an active member of this conversation');
    }

    const prefKey = `${NOTIF_PREF_KEY_PREFIX}${userId}:${conversationId}`;
    const existingRaw = await this.redis.get(prefKey);
    const existing = existingRaw ? JSON.parse(existingRaw) : {};

    const updatedPref = {
      isMuted: dto.isMuted ?? existing.isMuted ?? membership.conversation.isMuted,
      mutedUntil:
        dto.mutedUntil !== undefined
          ? dto.mutedUntil
          : existing.mutedUntil ?? membership.conversation.mutedUntil,
      customSound:
        dto.customSound !== undefined
          ? dto.customSound
          : existing.customSound ?? 'default',
      showPreview: dto.showPreview ?? existing.showPreview ?? true,
      updatedAt: new Date().toISOString(),
    };

    await this.redis.set(prefKey, JSON.stringify(updatedPref));

    if (dto.isMuted !== undefined || dto.mutedUntil !== undefined) {
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          ...(dto.isMuted !== undefined && { isMuted: dto.isMuted }),
          ...(dto.mutedUntil !== undefined && {
            mutedUntil: dto.mutedUntil ? new Date(dto.mutedUntil) : null,
          }),
        },
      });
    }

    return {
      conversationId,
      ...updatedPref,
    };
  }

  async getStorageStats(userId: string) {
    const memberships = await this.prisma.conversationMember.findMany({
      where: { userId, isActive: true, leftAt: null },
      select: {
        conversationId: true,
        conversation: {
          select: {
            id: true,
            type: true,
            group: { select: { name: true, avatarUrl: true } },
            members: {
              where: { userId: { not: userId }, isActive: true },
              take: 1,
              include: {
                user: { select: { id: true, displayName: true, avatarUrl: true } },
              },
            },
          },
        },
      },
    });

    const conversationIds = memberships.map((m) => m.conversationId);
    if (conversationIds.length === 0) {
      return { totalBytes: 0, totalFiles: 0, conversations: [] };
    }

    const attachments = await this.prisma.messageAttachment.findMany({
      where: {
        message: {
          conversationId: { in: conversationIds },
          isDeletedForEveryone: false,
        },
      },
      select: {
        fileSize: true,
        fileType: true,
        message: {
          select: { conversationId: true },
        },
      },
    });

    const statsMap = new Map<
      string,
      { totalBytes: number; fileCount: number; byType: Record<string, number> }
    >();

    let grandTotalBytes = 0;
    let grandTotalFiles = 0;

    for (const att of attachments) {
      const convId = att.message.conversationId;
      const size = att.fileSize ?? 0;
      grandTotalBytes += size;
      grandTotalFiles += 1;

      let entry = statsMap.get(convId);
      if (!entry) {
        entry = { totalBytes: 0, fileCount: 0, byType: {} };
        statsMap.set(convId, entry);
      }
      entry.totalBytes += size;
      entry.fileCount += 1;
      entry.byType[att.fileType] = (entry.byType[att.fileType] ?? 0) + size;
    }

    const conversations = memberships.map((m) => {
      const peer = m.conversation.members[0]?.user ?? null;
      const stats = statsMap.get(m.conversationId) ?? {
        totalBytes: 0,
        fileCount: 0,
        byType: {},
      };
      return {
        conversationId: m.conversationId,
        type: m.conversation.type,
        title: m.conversation.group?.name ?? peer?.displayName ?? 'Conversation',
        avatarUrl: m.conversation.group?.avatarUrl ?? peer?.avatarUrl ?? null,
        totalBytes: stats.totalBytes,
        fileCount: stats.fileCount,
        byType: stats.byType,
      };
    });

    conversations.sort((a, b) => b.totalBytes - a.totalBytes);

    return {
      totalBytes: grandTotalBytes,
      totalFiles: grandTotalFiles,
      conversations,
    };
  }

  async clearConversationStorage(userId: string, conversationId: string) {
    const membership = await this.prisma.conversationMember.findUnique({
      where: {
        conversationId_userId: { conversationId, userId },
      },
    });

    if (!membership || !membership.isActive) {
      throw new ForbiddenException('You are not an active member of this conversation');
    }

    const existing = await this.prisma.messageAttachment.aggregate({
      where: {
        message: { conversationId },
      },
      _sum: { fileSize: true },
      _count: { id: true },
    });

    const deleted = await this.prisma.messageAttachment.deleteMany({
      where: {
        message: { conversationId },
      },
    });

    return {
      conversationId,
      deletedFiles: deleted.count,
      freedBytes: existing._sum.fileSize ?? 0,
    };
  }

  async triggerBackup(userId: string, dto: TriggerBackupDto = {}) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const [conversationCount, messageCount, mediaAggregate] = await Promise.all([
      this.prisma.conversationMember.count({
        where: { userId, isActive: true, leftAt: null },
      }),
      this.prisma.message.count({
        where: {
          conversation: {
            members: { some: { userId, isActive: true, leftAt: null } },
          },
          isDeletedForEveryone: false,
        },
      }),
      this.prisma.messageAttachment.aggregate({
        where: {
          message: {
            conversation: {
              members: { some: { userId, isActive: true, leftAt: null } },
            },
          },
        },
        _sum: { fileSize: true },
        _count: { id: true },
      }),
    ]);

    const backupSummary = {
      backupId: `bkp_${userId.slice(0, 8)}_${Date.now()}`,
      status: 'COMPLETED',
      includeMedia: dto.includeMedia ?? true,
      conversationCount,
      messageCount,
      mediaCount: dto.includeMedia === false ? 0 : mediaAggregate._count.id,
      estimatedSizeBytes:
        messageCount * 256 +
        (dto.includeMedia === false ? 0 : mediaAggregate._sum.fileSize ?? 0),
      completedAt: new Date().toISOString(),
    };

    await this.prisma.chatSetting.upsert({
      where: { userId },
      update: { backupEnabled: true },
      create: { userId, backupEnabled: true },
    });

    await this.redis.set(`${BACKUP_KEY_PREFIX}${userId}`, JSON.stringify(backupSummary));

    await this.prisma.auditLog.create({
      data: {
        actorId: userId,
        action: 'CHAT_BACKUP_TRIGGERED',
        entityType: 'ChatSetting',
        entityId: userId,
        metadata: backupSummary,
      },
    });

    return backupSummary;
  }
}

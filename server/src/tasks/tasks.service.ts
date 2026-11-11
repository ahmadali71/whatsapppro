import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PrivacyService } from '../privacy/privacy.service';
import { StatusesService } from '../statuses/statuses.service';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly statusesService: StatusesService,
    private readonly privacyService: PrivacyService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'delete-expired-statuses' })
  async handleDeleteExpiredStatuses() {
    try {
      const count = await this.statusesService.deleteExpiredStatuses();
      if (count > 0) {
        this.logger.log(`Hourly cleanup removed ${count} expired statuses`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to delete expired statuses: ${(error as Error).message}`,
      );
    }
  }

  @Cron(CronExpression.EVERY_HOUR, { name: 'delete-disappearing-messages' })
  async handleDeleteDisappearingMessages() {
    try {
      const count = await this.privacyService.deleteDisappearingMessages();
      if (count > 0) {
        this.logger.log(`Hourly cleanup removed ${count} disappearing messages`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to delete disappearing messages: ${(error as Error).message}`,
      );
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: 'cleanup-expired-sessions' })
  async handleCleanupExpiredSessions() {
    try {
      const now = new Date();
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const result = await this.prisma.authenticationSession.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: now } },
            { isRevoked: true, updatedAt: { lt: thirtyDaysAgo } },
          ],
        },
      });

      this.logger.log(`Daily cleanup removed ${result.count} expired/stale auth sessions`);
    } catch (error) {
      this.logger.error(
        `Failed to cleanup expired sessions: ${(error as Error).message}`,
      );
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'reconcile-stale-online-users' })
  async handleStaleOfflineStatus() {
    try {
      const staleThreshold = new Date(Date.now() - 5 * 60 * 1000);

      const onlineProfiles = await this.prisma.userProfile.findMany({
        where: {
          isOnline: true,
          updatedAt: { lt: staleThreshold },
        },
        select: {
          id: true,
          userId: true,
        },
      });

      if (onlineProfiles.length === 0) {
        return;
      }

      const staleUserIds: string[] = [];
      for (const profile of onlineProfiles) {
        // Respect active Redis socket presence keys if present
        const hasPresence =
          (await this.redis.exists(`online:${profile.userId}`)) > 0 ||
          (await this.redis.exists(`presence:${profile.userId}`)) > 0 ||
          (await this.redis.exists(`user:online:${profile.userId}`)) > 0 ||
          (await this.redis.exists(`socket:user:${profile.userId}`)) > 0;

        if (!hasPresence) {
          staleUserIds.push(profile.userId);
        }
      }

      if (staleUserIds.length > 0) {
        const result = await this.prisma.userProfile.updateMany({
          where: {
            userId: { in: staleUserIds },
            isOnline: true,
          },
          data: {
            isOnline: false,
            lastSeen: new Date(),
            isTypingInConversationId: null,
          },
        });
        this.logger.log(
          `Marked ${result.count} stale disconnected users as offline`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to reconcile offline status: ${(error as Error).message}`,
      );
    }
  }
}

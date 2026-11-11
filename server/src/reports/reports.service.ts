import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CreateReportDto } from './dto/create-report.dto';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async createReport(reporterId: string, dto: CreateReportDto) {
    const reportedMessageId = dto.messageId ?? dto.reportedMessageId ?? null;
    let reportedUserId = dto.reportedUserId ?? null;

    if (!reportedUserId && !reportedMessageId) {
      throw new BadRequestException(
        'Either reportedUserId or messageId must be provided',
      );
    }

    if (reportedMessageId) {
      const msg = await this.prisma.message.findUnique({
        where: { id: reportedMessageId },
        select: { id: true, senderId: true },
      });
      if (!msg) {
        throw new NotFoundException('Reported message not found');
      }
      if (!reportedUserId) {
        reportedUserId = msg.senderId;
      }
    }

    if (reportedUserId) {
      if (reportedUserId === reporterId) {
        throw new BadRequestException('You cannot report yourself');
      }
      const targetUser = await this.prisma.user.findUnique({
        where: { id: reportedUserId },
        select: { id: true },
      });
      if (!targetUser) {
        throw new NotFoundException('Reported user not found');
      }
    }

    const report = await this.prisma.report.create({
      data: {
        reporterId,
        reportedUserId,
        reportedMessageId,
        reason: dto.reason,
        description: dto.description ?? null,
      },
      include: {
        reportedUser: {
          select: {
            id: true,
            displayName: true,
            username: true,
          },
        },
      },
    });

    await this.notifyAdmins(report);

    await this.prisma.auditLog.create({
      data: {
        actorId: reporterId,
        action: 'REPORT_SUBMITTED',
        entityType: 'Report',
        entityId: report.id,
        metadata: {
          reason: report.reason,
          reportedUserId: report.reportedUserId,
          hasMessageReference: Boolean(report.reportedMessageId),
        },
      },
    });

    return report;
  }

  private async notifyAdmins(report: {
    id: string;
    reason: string;
    reportedUserId: string | null;
    createdAt: Date;
  }) {
    try {
      const admins = await this.prisma.user.findMany({
        where: {
          role: UserRole.ADMIN,
          isActive: true,
          deletedAt: null,
        },
        select: { id: true },
      });

      if (admins.length > 0) {
        await this.prisma.notification.createMany({
          data: admins.map((admin) => ({
            userId: admin.id,
            type: 'ADMIN_NEW_REPORT',
            title: 'New User Report Submitted',
            body: `A new report (${report.reason}) requires moderation review.`,
            data: {
              reportId: report.id,
              reason: report.reason,
              reportedUserId: report.reportedUserId,
            },
          })),
        });
      }

      await this.redis.publish(
        'admin:notifications',
        JSON.stringify({
          type: 'NEW_REPORT',
          reportId: report.id,
          reason: report.reason,
          reportedUserId: report.reportedUserId,
          createdAt: report.createdAt,
        }),
      );
    } catch (err) {
      this.logger.warn(
        `Failed to dispatch admin notification for report ${report.id}: ${(err as Error).message}`,
      );
    }
  }
}

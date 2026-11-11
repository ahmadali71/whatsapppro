import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import { Prisma, ReportStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  AdminAuditLogsQueryDto,
  AdminReportsQueryDto,
  AdminUsersQueryDto,
  ReviewReportDto,
  UpdateSystemConfigDto,
} from './dto/admin.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
  ) {}

  async getDashboardStats() {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);

    const [
      totalUsers,
      activeUsers,
      bannedUsers,
      onlineUsers,
      messagesToday,
      totalMessages,
      totalGroups,
      totalReports,
      pendingReports,
      activeCalls,
    ] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.count({
        where: { deletedAt: null, isActive: true, isBanned: false },
      }),
      this.prisma.user.count({ where: { isBanned: true, deletedAt: null } }),
      this.prisma.userProfile.count({ where: { isOnline: true } }),
      this.prisma.message.count({
        where: { createdAt: { gte: startOfToday } },
      }),
      this.prisma.message.count(),
      this.prisma.group.count({ where: { deletedAt: null } }),
      this.prisma.report.count(),
      this.prisma.report.count({ where: { status: ReportStatus.PENDING } }),
      this.prisma.call.count({ where: { status: { in: ['INITIATED', 'RINGING', 'ONGOING'] } } }),
    ]);

    return {
      totalUsers,
      activeUsers,
      bannedUsers,
      onlineUsers,
      messagesToday,
      totalMessages,
      totalGroups,
      totalReports,
      pendingReports,
      activeCalls,
      generatedAt: new Date().toISOString(),
    };
  }

  async getUsers(query: AdminUsersQueryDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(query.role ? { role: query.role } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.isBanned !== undefined ? { isBanned: query.isBanned } : {}),
      ...(query.search
        ? {
            OR: [
              { displayName: { contains: query.search, mode: 'insensitive' } },
              { username: { contains: query.search, mode: 'insensitive' } },
              { phoneNumber: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          phoneNumber: true,
          countryCode: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          role: true,
          isVerified: true,
          isActive: true,
          isBanned: true,
          twoFactorEnabled: true,
          createdAt: true,
          updatedAt: true,
          profile: {
            select: {
              isOnline: true,
              lastSeen: true,
              platform: true,
            },
          },
          _count: {
            select: {
              reportsReceived: true,
              devices: true,
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getUserDetails(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phoneNumber: true,
        countryCode: true,
        username: true,
        displayName: true,
        about: true,
        avatarUrl: true,
        role: true,
        isVerified: true,
        isActive: true,
        isBanned: true,
        twoFactorEnabled: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
        profile: {
          select: {
            lastSeen: true,
            isOnline: true,
            platform: true,
            appVersion: true,
          },
        },
        devices: {
          select: {
            id: true,
            deviceName: true,
            deviceType: true,
            platform: true,
            isActive: true,
            lastActiveAt: true,
            createdAt: true,
          },
        },
        _count: {
          select: {
            authSessions: true,
            groupMemberships: true,
            sentMessages: true,
            reportsSubmitted: true,
            reportsReceived: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async suspendUser(adminId: string, userId: string, reason: string, ipAddress?: string) {
    if (adminId === userId) {
      throw new BadRequestException('Admins cannot suspend their own account');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isBanned: true, deletedAt: true },
    });

    if (!user || user.deletedAt) {
      throw new NotFoundException('User not found');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const target = await tx.user.update({
        where: { id: userId },
        data: {
          isBanned: true,
          isActive: false,
        },
        select: {
          id: true,
          phoneNumber: true,
          displayName: true,
          isActive: true,
          isBanned: true,
          updatedAt: true,
        },
      });

      await tx.authenticationSession.updateMany({
        where: { userId, isRevoked: false },
        data: { isRevoked: true },
      });

      await tx.userProfile.updateMany({
        where: { userId },
        data: { isOnline: false, lastSeen: new Date() },
      });

      await tx.auditLog.create({
        data: {
          actorId: adminId,
          action: 'USER_SUSPENDED',
          entityType: 'User',
          entityId: userId,
          metadata: { reason },
          ipAddress: ipAddress ?? null,
        },
      });

      return target;
    });

    return updated;
  }

  async restoreUser(adminId: string, userId: string, ipAddress?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, deletedAt: true },
    });

    if (!user || user.deletedAt) {
      throw new NotFoundException('User not found');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const target = await tx.user.update({
        where: { id: userId },
        data: {
          isBanned: false,
          isActive: true,
        },
        select: {
          id: true,
          phoneNumber: true,
          displayName: true,
          isActive: true,
          isBanned: true,
          updatedAt: true,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: adminId,
          action: 'USER_RESTORED',
          entityType: 'User',
          entityId: userId,
          ipAddress: ipAddress ?? null,
        },
      });

      return target;
    });

    return updated;
  }

  async deleteUser(adminId: string, userId: string, ipAddress?: string) {
    if (adminId === userId) {
      throw new BadRequestException('Admins cannot delete their own account from admin API');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, deletedAt: true },
    });

    if (!user || user.deletedAt) {
      throw new NotFoundException('User not found');
    }

    const deletedAt = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const target = await tx.user.update({
        where: { id: userId },
        data: {
          isActive: false,
          deletedAt,
        },
        select: {
          id: true,
          isActive: true,
          deletedAt: true,
        },
      });

      await tx.authenticationSession.updateMany({
        where: { userId, isRevoked: false },
        data: { isRevoked: true },
      });

      await tx.auditLog.create({
        data: {
          actorId: adminId,
          action: 'USER_DELETED',
          entityType: 'User',
          entityId: userId,
          ipAddress: ipAddress ?? null,
        },
      });

      return target;
    });

    return result;
  }

  async getReports(query: AdminReportsQueryDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const where: Prisma.ReportWhereInput = {
      ...(query.status ? { status: query.status } : {}),
    };

    // Privacy rule: select ONLY flagged message metadata (never content)
    const [items, total] = await Promise.all([
      this.prisma.report.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          reason: true,
          description: true,
          status: true,
          reviewedAt: true,
          createdAt: true,
          reporter: {
            select: {
              id: true,
              displayName: true,
              username: true,
              phoneNumber: true,
            },
          },
          reportedUser: {
            select: {
              id: true,
              displayName: true,
              username: true,
              phoneNumber: true,
              isBanned: true,
            },
          },
          reportedMessage: {
            select: {
              id: true,
              conversationId: true,
              senderId: true,
              messageType: true,
              isEncrypted: true,
              isDeletedForEveryone: true,
              sentAt: true,
              createdAt: true,
            },
          },
          reviewer: {
            select: {
              id: true,
              displayName: true,
              username: true,
            },
          },
        },
      }),
      this.prisma.report.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getReportDetails(reportId: string) {
    // Privacy rule: flagged message metadata only, NO message content and NO conversation history
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: {
        id: true,
        reason: true,
        description: true,
        status: true,
        reviewedAt: true,
        createdAt: true,
        reporter: {
          select: {
            id: true,
            displayName: true,
            username: true,
            phoneNumber: true,
          },
        },
        reportedUser: {
          select: {
            id: true,
            displayName: true,
            username: true,
            phoneNumber: true,
            isActive: true,
            isBanned: true,
            createdAt: true,
            _count: {
              select: { reportsReceived: true },
            },
          },
        },
        reportedMessage: {
          select: {
            id: true,
            conversationId: true,
            senderId: true,
            messageType: true,
            isEdited: true,
            isDeletedForEveryone: true,
            isEncrypted: true,
            sentAt: true,
            createdAt: true,
            _count: {
              select: { attachments: true, reports: true },
            },
          },
        },
        reviewer: {
          select: {
            id: true,
            displayName: true,
            username: true,
          },
        },
      },
    });

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    return report;
  }

  async reviewReport(
    adminId: string,
    reportId: string,
    dto: ReviewReportDto,
    ipAddress?: string,
  ) {
    const existing = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: { id: true, status: true },
    });

    if (!existing) {
      throw new NotFoundException('Report not found');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const report = await tx.report.update({
        where: { id: reportId },
        data: {
          status: dto.status as ReportStatus,
          reviewedBy: adminId,
          reviewedAt: new Date(),
        },
        select: {
          id: true,
          status: true,
          reviewedBy: true,
          reviewedAt: true,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: adminId,
          action: 'REPORT_REVIEWED',
          entityType: 'Report',
          entityId: reportId,
          metadata: {
            previousStatus: existing.status,
            newStatus: dto.status,
            notes: dto.notes ?? null,
          },
          ipAddress: ipAddress ?? null,
        },
      });

      return report;
    });

    return updated;
  }

  async getAuditLogs(query: AdminAuditLogsQueryDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const createdAtFilter: Prisma.DateTimeFilter = {};
    if (query.dateFrom) createdAtFilter.gte = new Date(query.dateFrom);
    if (query.dateTo) createdAtFilter.lte = new Date(query.dateTo);

    const where: Prisma.AuditLogWhereInput = {
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.action
        ? { action: { contains: query.action, mode: 'insensitive' } }
        : {}),
      ...(query.entityType
        ? { entityType: { equals: query.entityType, mode: 'insensitive' } }
        : {}),
      ...(Object.keys(createdAtFilter).length > 0 ? { createdAt: createdAtFilter } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          actor: {
            select: {
              id: true,
              displayName: true,
              username: true,
              role: true,
            },
          },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async checkSystemHealth() {
    const checks: Record<string, { status: 'up' | 'down' | 'unconfigured'; latencyMs?: number; detail?: string }> = {};

    // Database check
    const dbStart = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = { status: 'up', latencyMs: Date.now() - dbStart };
    } catch (err) {
      checks.database = {
        status: 'down',
        latencyMs: Date.now() - dbStart,
        detail: (err as Error).message,
      };
    }

    // Redis check
    const redisStart = Date.now();
    try {
      const pong = await this.redis.ping();
      checks.redis = {
        status: pong === 'PONG' ? 'up' : 'down',
        latencyMs: Date.now() - redisStart,
      };
    } catch (err) {
      checks.redis = {
        status: 'down',
        latencyMs: Date.now() - redisStart,
        detail: (err as Error).message,
      };
    }

    // S3 Storage check
    const bucket = this.configService.get<string>('AWS_S3_BUCKET');
    const region = this.configService.get<string>('AWS_S3_REGION');
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');

    if (!bucket || !region || !accessKeyId || !secretAccessKey) {
      checks.storage = {
        status: 'unconfigured',
        detail: 'AWS S3 credentials or bucket not configured',
      };
    } else {
      const s3Start = Date.now();
      try {
        const s3 = new S3Client({
          region,
          credentials: { accessKeyId, secretAccessKey },
        });
        await s3.send(new HeadBucketCommand({ Bucket: bucket }));
        checks.storage = { status: 'up', latencyMs: Date.now() - s3Start };
      } catch (err) {
        checks.storage = {
          status: 'down',
          latencyMs: Date.now() - s3Start,
          detail: (err as Error).message,
        };
      }
    }

    const overallHealthy =
      checks.database.status === 'up' && checks.redis.status === 'up';

    return {
      status: overallHealthy ? 'healthy' : 'degraded',
      uptimeSeconds: Math.floor(process.uptime()),
      memoryUsage: process.memoryUsage(),
      checks,
      timestamp: new Date().toISOString(),
    };
  }

  async getStorageUsageStats() {
    const [totalAggregate, groupedByType] = await Promise.all([
      this.prisma.messageAttachment.aggregate({
        _sum: { fileSize: true },
        _count: { id: true },
      }),
      this.prisma.messageAttachment.groupBy({
        by: ['fileType'],
        _sum: { fileSize: true },
        _count: { id: true },
      }),
    ]);

    return {
      totalFiles: totalAggregate._count.id,
      totalBytes: totalAggregate._sum.fileSize ?? 0,
      breakdownByType: groupedByType.map((g) => ({
        fileType: g.fileType,
        fileCount: g._count.id,
        totalBytes: g._sum.fileSize ?? 0,
      })),
    };
  }

  async getSystemConfigs() {
    return this.prisma.systemConfig.findMany({
      orderBy: { key: 'asc' },
    });
  }

  async updateSystemConfig(
    adminId: string,
    dto: UpdateSystemConfigDto,
    ipAddress?: string,
  ) {
    const config = await this.prisma.systemConfig.upsert({
      where: { key: dto.key },
      update: {
        value: dto.value as Prisma.InputJsonValue,
        updatedBy: adminId,
      },
      create: {
        key: dto.key,
        value: dto.value as Prisma.InputJsonValue,
        updatedBy: adminId,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: 'SYSTEM_CONFIG_UPDATED',
        entityType: 'SystemConfig',
        entityId: dto.key,
        metadata: { value: dto.value },
        ipAddress: ipAddress ?? null,
      },
    });

    return config;
  }
}

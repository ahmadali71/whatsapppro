import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import {
  StatusContentType,
  StatusPrivacy,
  StatusVisibilityScope,
  UserRole,
} from '@prisma/client';
import { StatusesController } from '../src/statuses/statuses.controller';
import { StatusesService } from '../src/statuses/statuses.service';
import { ReportsController } from '../src/reports/reports.controller';
import { ReportsService } from '../src/reports/reports.service';
import { AdminController } from '../src/admin/admin.controller';
import { AdminService } from '../src/admin/admin.service';
import { AdminGuard } from '../src/admin/admin.guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';

describe('Statuses, Reports & Admin Metadata-Only Suite', () => {
  let statusesController: StatusesController;
  let statusesService: StatusesService;
  let reportsController: ReportsController;
  let adminController: AdminController;
  let adminService: AdminService;
  let adminGuard: AdminGuard;

  const redisStore = new Map<string, string>();
  const mockRedisClient = {
    zadd: jest.fn(async () => 1),
    zrem: jest.fn(async () => 1),
  };

  const mockRedisService = {
    get: jest.fn(async (key: string) => redisStore.get(key) ?? null),
    set: jest.fn(async (key: string, val: string) => {
      redisStore.set(key, val);
      return 'OK';
    }),
    del: jest.fn(async (key: string) => {
      redisStore.delete(key);
      return 1;
    }),
    publish: jest.fn(async () => 1),
    getClient: jest.fn(() => mockRedisClient),
  };

  const mockPrismaService: any = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    userProfile: {
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    privacySetting: {
      findUnique: jest.fn(),
    },
    contact: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    conversationMember: {
      findMany: jest.fn(),
    },
    conversation: {
      findFirst: jest.fn(),
    },
    blockedUser: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    status: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    statusView: {
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
    statusReaction: {
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
    message: {
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    },
    group: { count: jest.fn() },
    call: { count: jest.fn() },
    report: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    notification: {
      createMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    authenticationSession: {
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(async (arg: any) => {
      if (typeof arg === 'function') {
        return arg(mockPrismaService);
      }
      return Promise.all(arg);
    }),
  };

  const mockConfigService = {
    get: jest.fn((_key: string, defaultValue?: string) => defaultValue),
  };

  beforeEach(async () => {
    redisStore.clear();
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StatusesController, ReportsController, AdminController],
      providers: [
        StatusesService,
        ReportsService,
        AdminService,
        AdminGuard,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    statusesController = module.get<StatusesController>(StatusesController);
    statusesService = module.get<StatusesService>(StatusesService);
    reportsController = module.get<ReportsController>(ReportsController);
    adminController = module.get<AdminController>(AdminController);
    adminService = module.get<AdminService>(AdminService);
    adminGuard = module.get<AdminGuard>(AdminGuard);
  });

  describe('Status upload, privacy filtering, view tracking & 24h expiry', () => {
    it('creates a status with 24h expiry and SELECTED audience in Redis', async () => {
      mockPrismaService.status.create.mockImplementation(async ({ data }: any) => ({
        id: 'st-1',
        ...data,
      }));

      const before = Date.now();
      const res = await statusesController.createStatus(
        { user: { id: 'u1' } },
        {
          contentType: StatusContentType.TEXT,
          textContent: 'Hello world!',
          privacy: StatusPrivacy.SELECTED,
          selectedUserIds: ['u2'],
        },
      );

      expect(res.success).toBe(true);
      const diffHours =
        (new Date(res.data.expiresAt).getTime() - before) / (1000 * 60 * 60);
      expect(diffHours).toBeGreaterThan(23.9);
      expect(diffHours).toBeLessThanOrEqual(24.1);
      expect(redisStore.get('status:selected:st-1')).toBe(JSON.stringify(['u2']));
      expect(mockRedisClient.zadd).toHaveBeenCalled();
    });

    it('filters contacts statuses by privacy, blocked users, and SELECTED audience', async () => {
      mockPrismaService.contact.findMany.mockResolvedValue([
        { contactId: 'owner-1' },
        { contactId: 'owner-blocked' },
      ]);
      mockPrismaService.conversationMember.findMany.mockResolvedValue([]);
      mockPrismaService.blockedUser.findMany.mockResolvedValue([
        { blockerId: 'owner-blocked', blockedId: 'viewer-1' },
      ]);

      const future = new Date(Date.now() + 3600_000);
      redisStore.set('status:selected:st-selected-allow', JSON.stringify(['viewer-1']));
      redisStore.set('status:selected:st-selected-deny', JSON.stringify(['someone-else']));

      mockPrismaService.status.findMany.mockResolvedValue([
        {
          id: 'st-selected-allow',
          userId: 'owner-1',
          contentType: StatusContentType.TEXT,
          textContent: 'Allowed',
          privacy: StatusPrivacy.SELECTED,
          expiresAt: future,
          createdAt: new Date(),
          user: {
            id: 'owner-1',
            displayName: 'Owner',
            isActive: true,
            isBanned: false,
            privacySettings: { statusVisibility: StatusVisibilityScope.ALL },
            ownedContacts: [{ id: 'c1' }],
          },
          views: [],
          reactions: [],
        },
        {
          id: 'st-selected-deny',
          userId: 'owner-1',
          contentType: StatusContentType.TEXT,
          textContent: 'Hidden',
          privacy: StatusPrivacy.SELECTED,
          expiresAt: future,
          createdAt: new Date(),
          user: {
            id: 'owner-1',
            displayName: 'Owner',
            isActive: true,
            isBanned: false,
            privacySettings: { statusVisibility: StatusVisibilityScope.ALL },
            ownedContacts: [{ id: 'c1' }],
          },
          views: [],
          reactions: [],
        },
      ]);

      const tray = await statusesService.getContactsStatuses('viewer-1');
      expect(tray).toHaveLength(1);
      expect(tray[0].statuses).toHaveLength(1);
      expect(tray[0].statuses[0].id).toBe('st-selected-allow');
    });

    it('shows direct-chat peer StatusPrivacy.ALL and CONTACTS statuses while hiding NONE/NOBODY/blocked', async () => {
      mockPrismaService.contact.findMany.mockResolvedValue([]);
      mockPrismaService.conversationMember.findMany.mockResolvedValue([
        { userId: 'peer-1' },
        { userId: 'peer-nobody' },
        { userId: 'peer-blocked' },
      ]);
      mockPrismaService.blockedUser.findMany.mockResolvedValue([
        { blockerId: 'viewer-1', blockedId: 'peer-blocked' },
      ]);

      const future = new Date(Date.now() + 3600_000);
      mockPrismaService.status.findMany.mockResolvedValue([
        {
          id: 'st-peer-all',
          userId: 'peer-1',
          contentType: StatusContentType.TEXT,
          textContent: 'Public to chat peers',
          privacy: StatusPrivacy.ALL,
          expiresAt: future,
          createdAt: new Date(),
          user: {
            id: 'peer-1',
            displayName: 'Peer One',
            username: 'peer1',
            avatarUrl: null,
            isActive: true,
            isBanned: false,
            privacySettings: { statusVisibility: StatusVisibilityScope.CONTACTS },
            ownedContacts: [],
          },
          views: [],
          reactions: [],
        },
        {
          id: 'st-peer-contacts',
          userId: 'peer-1',
          contentType: StatusContentType.TEXT,
          textContent: 'Contacts or direct chat peer',
          privacy: StatusPrivacy.CONTACTS,
          expiresAt: future,
          createdAt: new Date(),
          user: {
            id: 'peer-1',
            displayName: 'Peer One',
            username: 'peer1',
            avatarUrl: null,
            isActive: true,
            isBanned: false,
            privacySettings: { statusVisibility: StatusVisibilityScope.CONTACTS },
            ownedContacts: [],
          },
          views: [],
          reactions: [],
        },
        {
          id: 'st-peer-none',
          userId: 'peer-1',
          contentType: StatusContentType.TEXT,
          textContent: 'Private NONE',
          privacy: StatusPrivacy.NONE,
          expiresAt: future,
          createdAt: new Date(),
          user: {
            id: 'peer-1',
            displayName: 'Peer One',
            username: 'peer1',
            avatarUrl: null,
            isActive: true,
            isBanned: false,
            privacySettings: { statusVisibility: StatusVisibilityScope.ALL },
            ownedContacts: [],
          },
          views: [],
          reactions: [],
        },
        {
          id: 'st-peer-nobody',
          userId: 'peer-nobody',
          contentType: StatusContentType.TEXT,
          textContent: 'Owner NOBODY setting',
          privacy: StatusPrivacy.ALL,
          expiresAt: future,
          createdAt: new Date(),
          user: {
            id: 'peer-nobody',
            displayName: 'Peer Nobody',
            username: 'nobody',
            avatarUrl: null,
            isActive: true,
            isBanned: false,
            privacySettings: { statusVisibility: StatusVisibilityScope.NOBODY },
            ownedContacts: [],
          },
          views: [],
          reactions: [],
        },
      ]);

      const tray = await statusesService.getContactsStatuses('viewer-1');
      expect(mockPrismaService.status.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: { in: ['peer-1', 'peer-nobody'] },
          }),
        }),
      );
      expect(tray).toHaveLength(1);
      expect(tray[0].user.id).toBe('peer-1');
      expect(tray[0].statuses.map((s) => s.id)).toEqual([
        'st-peer-all',
        'st-peer-contacts',
      ]);
    });

    it('tracks views and restricts viewer list to status owner', async () => {
      const future = new Date(Date.now() + 3600_000);
      mockPrismaService.status.findUnique.mockResolvedValue({
        id: 'st-1',
        userId: 'owner-1',
        privacy: StatusPrivacy.ALL,
        expiresAt: future,
      });
      mockPrismaService.blockedUser.findFirst.mockResolvedValue(null);
      mockPrismaService.statusView.upsert.mockResolvedValue({
        statusId: 'st-1',
        viewerId: 'viewer-1',
      });

      const view = await statusesService.viewStatus('st-1', 'viewer-1');
      expect(view).toEqual({ statusId: 'st-1', viewerId: 'viewer-1' });

      await expect(statusesService.getStatusViewers('st-1', 'viewer-1')).rejects.toThrow(
        ForbiddenException,
      );

      mockPrismaService.statusView.findMany.mockResolvedValue([{ viewerId: 'viewer-1' }]);
      mockPrismaService.statusReaction.findMany.mockResolvedValue([]);
      const viewers = await statusesService.getStatusViewers('st-1', 'owner-1');
      expect(viewers.totalViews).toBe(1);
    });

    it('deletes expired statuses past 24h TTL and removes from Redis zset', async () => {
      mockPrismaService.status.findMany.mockResolvedValue([
        { id: 'st-exp-1' },
        { id: 'st-exp-2' },
      ]);
      mockPrismaService.status.deleteMany.mockResolvedValue({ count: 2 });

      const count = await statusesService.deleteExpiredStatuses();
      expect(count).toBe(2);
      expect(mockRedisClient.zrem).toHaveBeenCalledWith(
        'statuses:expiry_schedule',
        'st-exp-1',
        'st-exp-2',
      );
    });
  });

  describe('Report submission & Admin metadata-only enforcement', () => {
    it('submits report, notifies active admins, and logs audit entry', async () => {
      mockPrismaService.message.findUnique.mockResolvedValue({
        id: 'msg-bad',
        senderId: 'u-bad',
      });
      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'u-bad' });
      mockPrismaService.report.create.mockResolvedValue({
        id: 'rep-1',
        reporterId: 'u1',
        reportedUserId: 'u-bad',
        reportedMessageId: 'msg-bad',
        reason: 'SPAM',
        createdAt: new Date(),
      });
      mockPrismaService.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);

      const res = await reportsController.createReport(
        { user: { id: 'u1' } },
        {
          reportedUserId: 'u-bad',
          messageId: 'msg-bad',
          reason: 'SPAM',
          description: 'Repeated spam links',
        },
      );

      expect(res.success).toBe(true);
      expect(mockPrismaService.notification.createMany).toHaveBeenCalled();
      expect(mockRedisService.publish).toHaveBeenCalledWith(
        'admin:notifications',
        expect.stringContaining('rep-1'),
      );
      expect(mockPrismaService.auditLog.create).toHaveBeenCalled();
    });

    it('enforces AdminGuard role === ADMIN and active non-banned status', async () => {
      const makeCtx = (userId: string) =>
        ({
          switchToHttp: () => ({
            getRequest: () => ({ user: { id: userId } }),
          }),
        }) as any;

      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        id: 'u-regular',
        role: UserRole.USER,
        isActive: true,
        isBanned: false,
        deletedAt: null,
      });
      await expect(adminGuard.canActivate(makeCtx('u-regular'))).rejects.toThrow(
        ForbiddenException,
      );

      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        id: 'admin-1',
        role: UserRole.ADMIN,
        isActive: true,
        isBanned: false,
        deletedAt: null,
      });
      await expect(adminGuard.canActivate(makeCtx('admin-1'))).resolves.toBe(true);
    });

    it('exposes metadata only in Admin reports/details (zero plaintext message content)', async () => {
      mockPrismaService.report.findMany.mockResolvedValue([
        {
          id: 'rep-1',
          reason: 'SPAM',
          reportedMessage: {
            id: 'msg-bad',
            conversationId: 'conv-1',
            senderId: 'u-bad',
            messageType: 'TEXT',
            isEncrypted: true,
          },
        },
      ]);
      mockPrismaService.report.count.mockResolvedValue(1);

      const listRes = await adminController.getReports({});
      expect(listRes.success).toBe(true);

      // Inspect the exact Prisma select projection to guarantee `content` is never queried
      const listCallArgs = mockPrismaService.report.findMany.mock.calls[0][0];
      expect(listCallArgs.select.reportedMessage.select.content).toBeUndefined();

      mockPrismaService.report.findUnique.mockResolvedValue({
        id: 'rep-1',
        reportedMessage: {
          id: 'msg-bad',
          conversationId: 'conv-1',
          senderId: 'u-bad',
          messageType: 'TEXT',
          isEncrypted: true,
        },
      });
      await adminService.getReportDetails('rep-1');
      const detailCallArgs = mockPrismaService.report.findUnique.mock.calls[0][0];
      expect(detailCallArgs.select.reportedMessage.select.content).toBeUndefined();
      expect(detailCallArgs.select.reportedMessage.select.conversation).toBeUndefined();
    });
  });
});

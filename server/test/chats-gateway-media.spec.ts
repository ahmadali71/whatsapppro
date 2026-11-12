import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { MessageType, ReceiptStatus } from '@prisma/client';
import { ChatsController } from '../src/chats/chats.controller';
import { ChatsService } from '../src/chats/chats.service';
import { ChatGateway } from '../src/gateway/chat.gateway';
import { GatewayService } from '../src/gateway/gateway.service';
import { MediaController } from '../src/media/media.controller';
import { MediaService } from '../src/media/media.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';

describe('Chats, Real-Time Messaging, Gateway & Media Suite', () => {
  let chatsController: ChatsController;
  let chatsService: ChatsService;
  let chatGateway: ChatGateway;
  let gatewayService: GatewayService;
  let mediaController: MediaController;
  let mediaService: MediaService;

  const redisSets = new Map<string, Set<string>>();
  const redisLists = new Map<string, string[]>();
  const redisKeys = new Map<string, string>();

  const mockRedisClient = {
    rpush: jest.fn(async (key: string, val: string) => {
      const list = redisLists.get(key) ?? [];
      list.push(val);
      redisLists.set(key, list);
      return list.length;
    }),
    expire: jest.fn(async () => 1),
    lrange: jest.fn(async (key: string, _start: number, _stop: number) => {
      return redisLists.get(key) ?? [];
    }),
    del: jest.fn(async (key: string) => {
      redisLists.delete(key);
      redisKeys.delete(key);
      return 1;
    }),
  };

  const mockRedisService = {
    get: jest.fn(async (key: string) => redisKeys.get(key) ?? null),
    set: jest.fn(async (key: string, val: string) => {
      redisKeys.set(key, val);
      return 'OK';
    }),
    del: jest.fn(async (key: string) => {
      redisKeys.delete(key);
      return 1;
    }),
    exists: jest.fn(async (key: string) => (redisKeys.has(key) ? 1 : 0)),
    sadd: jest.fn(async (key: string, ...members: string[]) => {
      const set = redisSets.get(key) ?? new Set<string>();
      members.forEach((m) => set.add(m));
      redisSets.set(key, set);
      return members.length;
    }),
    smembers: jest.fn(async (key: string) => Array.from(redisSets.get(key) ?? [])),
    rpush: jest.fn(async (key: string, ...vals: string[]) => {
      const list = redisLists.get(key) ?? [];
      list.push(...vals);
      redisLists.set(key, list);
      return list.length;
    }),
    expire: jest.fn(async () => 1),
    lrangeAndDel: jest.fn(async (key: string) => {
      const list = redisLists.get(key) ?? [];
      redisLists.delete(key);
      redisKeys.delete(key);
      return list;
    }),
    getClient: jest.fn(() => mockRedisClient),
  };

  const mockPrismaService: any = {
    user: { findUnique: jest.fn() },
    userProfile: { upsert: jest.fn(), updateMany: jest.fn() },
    blockedUser: { findFirst: jest.fn() },
    conversation: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    conversationMember: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    message: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    messageReceipt: {
      createMany: jest.fn(),
      upsert: jest.fn(),
    },
    messageReaction: {
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    messageEdit: {
      create: jest.fn(),
    },
    starredMessage: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    archivedChat: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(async (arg: any) => {
      if (typeof arg === 'function') {
        return arg(mockPrismaService);
      }
      return Promise.all(arg);
    }),
  };

  const mockJwtService = new JwtService({ secret: 'test-jwt-secret' });

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: string) => {
      const map: Record<string, string> = {
        JWT_SECRET: 'test-jwt-secret',
        AWS_S3_REGION: 'us-east-1',
        AWS_S3_BUCKET: 'test-bucket',
      };
      return map[key] ?? defaultValue;
    }),
  };

  const createMockSocketServer = () => {
    const emitted: Array<{ room?: string; event: string; data: unknown }> = [];
    const joinedByIn: Array<{ rooms: string | string[]; joinRoom: string }> = [];
    const server: any = {
      emitted,
      joinedByIn,
      in: jest.fn((rooms: string | string[]) => ({
        socketsJoin: jest.fn(async (joinRoom: string) => {
          joinedByIn.push({ rooms, joinRoom });
        }),
      })),
      to: jest.fn((room: string) => ({
        emit: jest.fn((event: string, data: unknown) => {
          emitted.push({ room, event, data });
        }),
        except: jest.fn(() => ({
          emit: jest.fn((event: string, data: unknown) => {
            emitted.push({ room, event, data });
          }),
        })),
      })),
    };
    return server;
  };

  beforeEach(async () => {
    redisSets.clear();
    redisLists.clear();
    redisKeys.clear();
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatsController, MediaController],
      providers: [
        ChatsService,
        GatewayService,
        ChatGateway,
        MediaService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    chatsController = module.get<ChatsController>(ChatsController);
    chatsService = module.get<ChatsService>(ChatsService);
    chatGateway = module.get<ChatGateway>(ChatGateway);
    gatewayService = module.get<GatewayService>(GatewayService);
    mediaController = module.get<MediaController>(MediaController);
    mediaService = module.get<MediaService>(MediaService);

    const mockServer = createMockSocketServer();
    chatGateway.server = mockServer;
    chatGateway.afterInit(mockServer);
  });

  describe('Direct chat creation', () => {
    it('rejects self-chat and blocked conversations, and creates new DIRECT chat otherwise', async () => {
      await expect(chatsService.createDirectConversation('u1', 'u1')).rejects.toThrow(
        BadRequestException,
      );

      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'u-any' });
      mockPrismaService.blockedUser.findFirst.mockResolvedValue({ id: 'blk-1' });
      await expect(chatsService.createDirectConversation('u1', 'u2')).rejects.toThrow(
        ForbiddenException,
      );

      mockPrismaService.blockedUser.findFirst.mockResolvedValue(null);
      mockPrismaService.conversation.findFirst.mockResolvedValue(null);
      mockPrismaService.conversation.create.mockResolvedValue({
        id: 'conv-1',
        type: 'DIRECT',
        members: [{ userId: 'u1' }, { userId: 'u2' }],
      });

      const created = await chatsController.createDirectChat(
        { user: { id: 'u1' } },
        { otherUserId: 'u2' },
      );
      expect(created.id).toBe('conv-1');
    });
  });

  describe('Real-time messaging, receipts, reactions, edit, delete, star, forward, offline sync', () => {
    it('sends a message, creates SENT receipts, broadcasts new_message, and queues offline recipients', async () => {
      mockPrismaService.conversationMember.findFirst.mockResolvedValue({
        id: 'cm-1',
        conversationId: 'conv-1',
        userId: 'u1',
        isActive: true,
      });
      mockPrismaService.conversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        type: 'DIRECT',
        members: [{ userId: 'u1' }, { userId: 'u2' }],
      });
      mockPrismaService.blockedUser.findFirst.mockResolvedValue(null);
      mockPrismaService.message.create.mockResolvedValue({
        id: 'msg-1',
        conversationId: 'conv-1',
        senderId: 'u1',
        content: 'ciphertext-base64',
        messageType: MessageType.TEXT,
        isEncrypted: true,
      });

      const msg = await chatsService.sendMessage('u1', 'conv-1', {
        messageType: MessageType.TEXT,
        content: 'ciphertext-base64',
        isEncrypted: true,
        encryptionMetadata: { ratchet: 1 },
      });

      expect(msg.id).toBe('msg-1');
      expect(mockPrismaService.messageReceipt.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({ messageId: 'msg-1', userId: 'u2', status: ReceiptStatus.SENT })],
        }),
      );
      // Auto-joined online members' sockets into conversation room before broadcast
      expect((gatewayService.getServer() as any).joinedByIn).toContainEqual({
        rooms: ['user:u1', 'user:u2'],
        joinRoom: 'conversation:conv-1',
      });
      // Broadcast to room
      expect((gatewayService.getServer() as any).emitted).toContainEqual(
        expect.objectContaining({
          room: 'conversation:conv-1',
          event: 'new_message',
        }),
      );
      // Queued for offline recipient u2
      expect(redisLists.get('offline_queue:u2')).toHaveLength(1);
    });

    it('flushes queued offline events when user reconnects via ChatGateway', async () => {
      await gatewayService.queueOfflineEvent('u2', 'new_message', { id: 'msg-1' }, 'conv-1', 'msg-1');
      mockPrismaService.conversationMember.findMany.mockResolvedValue([
        { conversationId: 'conv-1' },
      ]);

      const token = mockJwtService.sign({ sub: 'u2' }, { secret: 'test-jwt-secret' });
      const clientEmitted: Array<{ event: string; data: unknown }> = [];
      const mockSocket: any = {
        id: 'sock-u2',
        data: {},
        handshake: { auth: { token: `Bearer ${token}` }, headers: {} },
        join: jest.fn(async () => undefined),
        emit: jest.fn((event: string, data: unknown) => clientEmitted.push({ event, data })),
        disconnect: jest.fn(),
      };

      await chatGateway.handleConnection(mockSocket);

      expect(mockSocket.data.userId).toBe('u2');
      expect(mockSocket.join).toHaveBeenCalledWith('user:u2');
      expect(mockSocket.join).toHaveBeenCalledWith('conversation:conv-1');
      expect(redisKeys.get('online:u2')).toBe('sock-u2');
      expect(clientEmitted).toContainEqual({
        event: 'new_message',
        data: { id: 'msg-1' },
      });
      // Queue drained
      expect(redisLists.has('offline_queue:u2')).toBe(false);
    });

    it('updates delivered and read receipts via gateway and broadcasts message_receipt', async () => {
      mockPrismaService.message.findUnique.mockResolvedValue({
        id: 'msg-1',
        conversationId: 'conv-1',
        deliveredAt: null,
        readAt: null,
      });
      mockPrismaService.conversationMember.findFirst.mockResolvedValue({
        id: 'cm-2',
        conversationId: 'conv-1',
        userId: 'u2',
        isActive: true,
      });
      mockPrismaService.messageReceipt.upsert.mockImplementation(async ({ create }: any) => ({
        status: create.status,
        timestamp: new Date(),
      }));

      const client: any = { data: { userId: 'u2' } };

      const delivered = await chatGateway.handleMessageDelivered(client, { messageId: 'msg-1' });
      expect(delivered.status).toBe(ReceiptStatus.DELIVERED);

      const read = await chatGateway.handleMessageRead(client, {
        conversationId: 'conv-1',
        messageId: 'msg-1',
      });
      expect(read.status).toBe(ReceiptStatus.READ);
      expect(mockPrismaService.conversationMember.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { unreadCount: 0, lastReadMessageId: 'msg-1' },
        }),
      );
    });

    it('handles reactions toggle, edit (sender only), delete for me vs everyone, star, and forward', async () => {
      mockPrismaService.conversationMember.findFirst.mockResolvedValue({ id: 'cm-1', isActive: true });
      mockPrismaService.message.findUnique.mockResolvedValue({
        id: 'msg-1',
        conversationId: 'conv-1',
        senderId: 'u1',
        content: 'hello',
        messageType: MessageType.TEXT,
        isDeletedForEveryone: false,
        attachments: [],
      });

      // Reaction add
      mockPrismaService.messageReaction.findUnique.mockResolvedValueOnce(null);
      mockPrismaService.messageReaction.create.mockResolvedValue({ id: 'react-1', emoji: '👍' });
      const reactRes = await chatsService.addReaction('u1', 'msg-1', '👍');
      expect(reactRes.action).toBe('added');

      // Reaction toggle off
      mockPrismaService.messageReaction.findUnique.mockResolvedValueOnce({ id: 'react-1' });
      const unreactRes = await chatsService.addReaction('u1', 'msg-1', '👍');
      expect(unreactRes.action).toBe('removed');

      // Edit forbidden for non-sender
      await expect(chatsService.editMessage('u2', 'msg-1', 'hacked')).rejects.toThrow(
        ForbiddenException,
      );

      // Edit allowed for sender
      mockPrismaService.message.update.mockResolvedValue({
        id: 'msg-1',
        content: 'hello edited',
        isEdited: true,
      });
      const edited = await chatsService.editMessage('u1', 'msg-1', 'hello edited');
      expect(edited.isEdited).toBe(true);
      expect(mockPrismaService.messageEdit.create).toHaveBeenCalled();

      // Star & unstar
      mockPrismaService.starredMessage.upsert.mockResolvedValue({ id: 'star-1', messageId: 'msg-1' });
      const starred = await chatsService.starMessage('u1', 'msg-1');
      expect(starred.messageId).toBe('msg-1');

      // Forward
      mockPrismaService.message.create.mockResolvedValue({
        id: 'msg-2',
        conversationId: 'conv-2',
        forwardedFromId: 'msg-1',
      });
      const forwarded = await chatsService.forwardMessage('u1', 'msg-1', 'conv-2');
      expect(forwarded.forwardedFromId).toBe('msg-1');

      // Mark as read updates earlier unread messages and resets unreadCount
      mockPrismaService.message.findUnique.mockResolvedValueOnce({
        id: 'msg-1',
        conversationId: 'conv-1',
        senderId: 'u1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        readAt: null,
        deliveredAt: null,
      });
      mockPrismaService.messageReceipt.upsert.mockResolvedValueOnce({
        id: 'rec-1',
        timestamp: new Date('2026-01-01T00:01:00Z'),
      });
      const readRes = await chatsService.markAsRead('u2', 'conv-1', 'msg-1');
      expect(readRes.status).toBe('READ');
      expect(mockPrismaService.message.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            conversationId: 'conv-1',
            senderId: { not: 'u2' },
            readAt: null,
          }),
        }),
      );

      // Delete for me stores in Redis and filters getMessages
      const delForMe = await chatsService.deleteMessage('u2', 'msg-1', false);
      expect(delForMe).toEqual(
        expect.objectContaining({ deleteForEveryone: false, deleted: true }),
      );
      expect(redisSets.get('deleted_for_me:u2')?.has('msg-1')).toBe(true);

      mockPrismaService.message.findMany.mockResolvedValue([]);
      await chatsService.getMessages('conv-1', 'u2');
      expect(mockPrismaService.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { notIn: ['msg-1'] },
          }),
        }),
      );

      // Delete for everyone forbidden for non-sender, allowed for sender
      await expect(chatsService.deleteMessage('u2', 'msg-1', true)).rejects.toThrow(
        ForbiddenException,
      );
      mockPrismaService.message.update.mockResolvedValue({
        id: 'msg-1',
        isDeletedForEveryone: true,
        content: null,
      });
      const delAll = await chatsService.deleteMessage('u1', 'msg-1', true);
      expect((delAll as any).isDeletedForEveryone).toBe(true);
    });
  });

  describe('Media upload validation (size limits & MIME resolution)', () => {
    it('enforces 16MB limit on images/voice and 100MB limit on videos/documents', () => {
      expect(mediaService.validateFileSize(5 * 1024 * 1024, 'image')).toBe(true);
      expect(() => mediaService.validateFileSize(17 * 1024 * 1024, 'image')).toThrow(
        BadRequestException,
      );
      expect(() => mediaService.validateFileSize(17 * 1024 * 1024, 'voice')).toThrow(
        BadRequestException,
      );
      expect(mediaService.validateFileSize(50 * 1024 * 1024, 'video')).toBe(true);
      expect(() => mediaService.validateFileSize(101 * 1024 * 1024, 'video')).toThrow(
        BadRequestException,
      );
      expect(() => mediaService.validateFileSize(0, 'document')).toThrow(BadRequestException);
    });

    it('resolves category from MIME type and compresses/uploads images via MediaController', async () => {
      expect(mediaService.resolveCategoryFromMime('image/png')).toBe('image');
      expect(mediaService.resolveCategoryFromMime('video/mp4')).toBe('video');
      expect(mediaService.resolveCategoryFromMime('audio/ogg')).toBe('voice');
      expect(mediaService.resolveCategoryFromMime('application/pdf')).toBe('document');

      jest.spyOn(mediaService, 'compressImage').mockResolvedValue({
        buffer: Buffer.from('webp-bytes'),
        mimeType: 'image/webp',
      });
      jest.spyOn(mediaService, 'uploadFileWithKey').mockResolvedValue({
        key: 'messages/test.webp',
        url: 'https://test-bucket.s3.us-east-1.amazonaws.com/messages/test.webp',
      });

      const uploaded = await mediaController.uploadMedia(
        {
          originalname: 'photo.png',
          mimetype: 'image/png',
          size: 1024,
          buffer: Buffer.from('png-bytes'),
        } as Express.Multer.File,
        'messages',
      );

      expect(uploaded.category).toBe('image');
      expect(uploaded.mimeType).toBe('image/webp');
      expect(uploaded.key).toBe('messages/test.webp');

      // Fallback preserves original MIME type when sharp fails on invalid image bytes
      jest.restoreAllMocks();
      const rawBytes = Buffer.from('not-a-real-image');
      const fallbackCompressed = await mediaService.compressImage(rawBytes, 'image/png');
      expect(fallbackCompressed).toEqual({
        buffer: rawBytes,
        mimeType: 'image/png',
      });
    });

    it('falls back to local disk storage in non-production when S3 credentials are not configured', async () => {
      const { key, url } = await mediaService.uploadFileWithKey(
        Buffer.from('local-test-bytes'),
        'image/png',
        'test-avatars',
      );

      expect(url).toMatch(/^\/uploads\/test-avatars\/.+\.png$/);
      expect(key).toMatch(/^test-avatars\/.+\.png$/);

      const presigned = await mediaService.getPresignedUrl(key);
      expect(presigned).toBe(url);

      await expect(mediaService.deleteFile(key)).resolves.toBeUndefined();
    });

    it('uses inline data-URI fallback without S3 in production/Vercel and rejects > 2.5MB with BadRequestException', async () => {
      const prodConfig = {
        get: jest.fn((key: string, defaultValue?: string) => {
          const map: Record<string, string> = {
            NODE_ENV: 'production',
            AWS_S3_REGION: 'us-east-1',
            AWS_S3_BUCKET: 'test-bucket',
          };
          return map[key] ?? defaultValue;
        }),
      } as unknown as ConfigService;

      const prodMedia = new MediaService(prodConfig);
      const smallBytes = Buffer.from('inline-avatar-bytes');
      const { key, url } = await prodMedia.uploadFileWithKey(
        smallBytes,
        'image/png',
        'avatars',
      );

      expect(key).toMatch(/^inline:avatars\/.+\.png$/);
      expect(url).toBe(`data:image/png;base64,${smallBytes.toString('base64')}`);
      await expect(prodMedia.getPresignedUrl(key)).resolves.toBe(key);
      await expect(prodMedia.deleteFile(key)).resolves.toBeUndefined();

      const oversized = Buffer.alloc(2_500_001, 1);
      await expect(
        prodMedia.uploadFileWithKey(oversized, 'image/png', 'avatars'),
      ).rejects.toThrow(BadRequestException);

      // Also verify VERCEL=1 triggers inline fallback even if NODE_ENV !== 'production'
      const prevVercel = process.env.VERCEL;
      process.env.VERCEL = '1';
      try {
        const vercelMedia = new MediaService(mockConfigService as unknown as ConfigService);
        const vercelResult = await vercelMedia.uploadFileWithKey(
          smallBytes,
          'image/webp',
          'stickers',
        );
        expect(vercelResult.url).toBe(
          `data:image/webp;base64,${smallBytes.toString('base64')}`,
        );
      } finally {
        if (prevVercel === undefined) {
          delete process.env.VERCEL;
        } else {
          process.env.VERCEL = prevVercel;
        }
      }
    });
  });

  describe('Non-fatal Redis fallback in ChatsService', () => {
    it('succeeds in getMessages and sendMessage even when Redis throws', async () => {
      mockRedisService.get.mockRejectedValueOnce(new Error('Stream isn\'t writeable'));
      mockRedisService.set.mockRejectedValueOnce(new Error('Stream isn\'t writeable'));
      mockRedisService.del
        .mockRejectedValueOnce(new Error('Stream isn\'t writeable'))
        .mockRejectedValueOnce(new Error('Stream isn\'t writeable'));
      mockRedisService.rpush.mockRejectedValueOnce(new Error('Stream isn\'t writeable'));

      mockPrismaService.conversationMember.findFirst.mockResolvedValue({
        id: 'cm-1',
        conversationId: 'conv-1',
        userId: 'u1',
        isActive: true,
        clearedAt: null,
      });
      mockPrismaService.message.findMany.mockResolvedValue([
        {
          id: 'msg-1',
          conversationId: 'conv-1',
          senderId: 'u2',
          content: 'hello without redis',
          messageType: MessageType.TEXT,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          deletedForUsers: [],
          starredBy: [],
          isStarred: false,
        },
      ]);

      const page = await chatsService.getMessages('conv-1', 'u1', undefined, 20);
      expect(page.items).toHaveLength(1);
      expect(page.items[0].content).toBe('hello without redis');

      mockPrismaService.conversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        type: 'DIRECT',
        members: [{ userId: 'u1' }, { userId: 'u2' }],
      });
      mockPrismaService.blockedUser.findFirst.mockResolvedValue(null);
      mockPrismaService.message.create.mockResolvedValue({
        id: 'msg-2',
        conversationId: 'conv-1',
        senderId: 'u1',
        content: 'still sends',
        messageType: MessageType.TEXT,
      });

      const sent = await chatsService.sendMessage('u1', 'conv-1', {
        messageType: MessageType.TEXT,
        content: 'still sends',
      });
      expect(sent.id).toBe('msg-2');
    });
  });
});

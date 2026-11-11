import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CallStatus, CallType, MemberRole } from '@prisma/client';
import { GroupsController } from '../src/groups/groups.controller';
import { GroupsService } from '../src/groups/groups.service';
import { CallsController } from '../src/calls/calls.controller';
import { CallsService, MAX_MESH_PARTICIPANTS } from '../src/calls/calls.service';
import { CallsGateway } from '../src/calls/calls.gateway';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';

describe('Groups & WebRTC Calls Suite', () => {
  let groupsController: GroupsController;
  let groupsService: GroupsService;
  let callsController: CallsController;
  let callsService: CallsService;
  let callsGateway: CallsGateway;

  const mockPrismaService: any = {
    user: { findMany: jest.fn() },
    group: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    groupMember: {
      createMany: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    groupInvite: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    conversation: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    conversationMember: {
      createMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    call: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    callParticipant: {
      create: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(async (arg: any) => {
      if (typeof arg === 'function') {
        return arg(mockPrismaService);
      }
      return Promise.all(arg);
    }),
  };

  const mockRedisService = {
    sadd: jest.fn(async () => 1),
    srem: jest.fn(async () => 1),
    expire: jest.fn(async () => 1),
    del: jest.fn(async () => 1),
  };

  const mockNotificationsService = {
    sendGroupNotification: jest.fn(async () => undefined),
    sendCallNotification: jest.fn(async () => undefined),
  };

  const defaultConfigGet = (key: string, defaultValue?: string) => {
    const env: Record<string, string> = {
      JWT_SECRET: 'test-jwt-secret',
      WEBRTC_TURN_SERVER_URL: 'turn:turn.whatsapp-pro.local:3478',
      WEBRTC_TURN_USERNAME: 'turnuser',
      WEBRTC_TURN_CREDENTIAL: 'turnpass',
    };
    return env[key] ?? defaultValue;
  };

  const mockConfigService = {
    get: jest.fn(defaultConfigGet),
  };

  const createMockSocketServer = () => {
    const emitted: Array<{ room: string; event: string; data: unknown }> = [];
    const server: any = {
      emitted,
      use: jest.fn(),
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
    jest.clearAllMocks();
    mockPrismaService.groupMember.findUnique.mockReset();
    mockConfigService.get.mockImplementation(defaultConfigGet);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GroupsController, CallsController],
      providers: [
        GroupsService,
        CallsService,
        CallsGateway,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: JwtService, useValue: new JwtService({ secret: 'test-jwt-secret' }) },
      ],
    }).compile();

    groupsController = module.get<GroupsController>(GroupsController);
    groupsService = module.get<GroupsService>(GroupsService);
    callsController = module.get<CallsController>(CallsController);
    callsService = module.get<CallsService>(CallsService);
    callsGateway = module.get<CallsGateway>(CallsGateway);

    const mockServer = createMockSocketServer();
    callsGateway.server = mockServer;
    callsGateway.afterInit(mockServer);
  });

  describe('Groups: creation, admin permissions, invite link, exit & delete', () => {
    it('creates a group with OWNER + MEMBER roles and linked GROUP conversation', async () => {
      mockPrismaService.user.findMany.mockResolvedValue([{ id: 'u2' }]);
      mockPrismaService.group.create.mockResolvedValue({ id: 'grp-1', name: 'Core Team' });
      mockPrismaService.conversation.create.mockResolvedValue({ id: 'conv-grp-1', type: 'GROUP' });
      mockPrismaService.group.findUnique.mockResolvedValue({
        id: 'grp-1',
        name: 'Core Team',
        members: [
          { userId: 'u1', role: MemberRole.OWNER },
          { userId: 'u2', role: MemberRole.MEMBER },
        ],
        conversations: [{ id: 'conv-grp-1' }],
      });

      const created = await groupsController.createGroup('u1', {
        name: 'Core Team',
        description: 'Engineering',
        memberIds: ['u2'],
      });

      expect(created?.id).toBe('grp-1');
      expect(mockPrismaService.groupMember.createMany).toHaveBeenCalled();
      expect(mockPrismaService.conversationMember.createMany).toHaveBeenCalled();
      expect(mockNotificationsService.sendGroupNotification).toHaveBeenCalledWith(
        'GROUP_CREATED',
        'grp-1',
        'u1',
      );
    });

    it('enforces admin/owner permission on group updates and role promotion', async () => {
      mockPrismaService.group.findFirst.mockResolvedValue({ id: 'grp-1' });
      mockPrismaService.groupMember.findUnique.mockResolvedValue({
        userId: 'u2',
        role: MemberRole.MEMBER,
        isActive: true,
      });

      await expect(
        groupsService.updateGroup('grp-1', 'u2', { name: 'Hijacked' }),
      ).rejects.toThrow(ForbiddenException);

      // Admin cannot assign OWNER via promotion endpoint (checked right after admin validation)
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        userId: 'u1',
        role: MemberRole.OWNER,
        isActive: true,
      });
      await expect(
        groupsService.promoteMember('grp-1', 'u1', 'u2', MemberRole.OWNER),
      ).rejects.toThrow(BadRequestException);
    });

    it('generates, joins via, and revokes group invite links', async () => {
      mockPrismaService.group.findFirst.mockResolvedValue({ id: 'grp-1' });
      mockPrismaService.groupMember.findUnique.mockResolvedValue({
        userId: 'u1',
        role: MemberRole.OWNER,
        isActive: true,
      });
      mockPrismaService.groupInvite.create.mockResolvedValue({
        id: 'inv-1',
        groupId: 'grp-1',
        inviteCode: 'abc123code',
        isActive: true,
      });

      const invite = await groupsController.generateInviteLink('u1', 'grp-1');
      expect(invite.inviteUrl).toBe('/groups/join/abc123code');

      // Join via invite code
      mockPrismaService.groupInvite.findUnique.mockResolvedValue({
        id: 'inv-1',
        groupId: 'grp-1',
        inviteCode: 'abc123code',
        createdBy: 'u1',
        isActive: true,
        expiresAt: null,
        maxUses: 10,
        useCount: 0,
        group: {
          id: 'grp-1',
          deletedAt: null,
          inviteLinkEnabled: true,
          conversations: [{ id: 'conv-grp-1' }],
        },
      });
      mockPrismaService.groupMember.findUnique.mockResolvedValue(null);

      const joined = await groupsController.joinViaInviteLink('u3', 'abc123code');
      expect((joined as any).joined).toBe(true);
      expect(mockPrismaService.groupInvite.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { useCount: { increment: 1 } },
      });

      // Revoke and reject subsequent join
      mockPrismaService.groupMember.findUnique.mockResolvedValue({
        userId: 'u1',
        role: MemberRole.OWNER,
        isActive: true,
      });
      const revoked = await groupsController.revokeInviteLink('u1', 'grp-1');
      expect(revoked.revoked).toBe(true);

      mockPrismaService.groupInvite.findUnique.mockResolvedValue({
        id: 'inv-1',
        isActive: false,
        group: { deletedAt: null, inviteLinkEnabled: false },
      });
      await expect(groupsService.joinViaInviteLink('abc123code', 'u4')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('allows member self-exit, blocks owner self-exit, and allows owner-only group delete', async () => {
      mockPrismaService.group.findFirst.mockResolvedValue({
        id: 'grp-1',
        createdBy: 'u1',
        conversations: [{ id: 'conv-grp-1' }],
      });

      // Owner cannot self-exit
      mockPrismaService.groupMember.findUnique.mockResolvedValue({
        userId: 'u1',
        role: MemberRole.OWNER,
        isActive: true,
      });
      await expect(groupsService.removeMember('grp-1', 'u1', 'u1')).rejects.toThrow(
        BadRequestException,
      );

      // Member self-exit succeeds
      mockPrismaService.groupMember.findUnique.mockResolvedValue({
        userId: 'u2',
        role: MemberRole.MEMBER,
        isActive: true,
      });
      mockPrismaService.conversation.findFirst.mockResolvedValue({ id: 'conv-grp-1' });
      const exited = await groupsService.removeMember('grp-1', 'u2', 'u2');
      expect(exited.removed).toBe(true);

      // Non-owner cannot delete group
      await expect(groupsService.deleteGroup('grp-1', 'u2')).rejects.toThrow(ForbiddenException);

      // Owner can delete group
      mockPrismaService.groupMember.findUnique.mockResolvedValue({
        userId: 'u1',
        role: MemberRole.OWNER,
        isActive: true,
      });
      const deleted = await groupsController.deleteGroup('u1', 'grp-1');
      expect(deleted.deleted).toBe(true);
    });
  });

  describe('WebRTC Calls: ICE servers, initiation, signaling relay, reject & end', () => {
    it('returns STUN + TURN ICE servers and documents SFU limit beyond 8 peers', () => {
      const config = callsController.getIceServers();
      expect(config.hasTurn).toBe(true);
      expect(config.iceServers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ urls: 'stun:stun.l.google.com:19302' }),
          expect.objectContaining({
            urls: 'turn:turn.whatsapp-pro.local:3478',
            username: 'turnuser',
            credential: 'turnpass',
          }),
        ]),
      );
      expect(config.maxMeshParticipants).toBe(MAX_MESH_PARTICIPANTS);
      expect(callsService.getWebRtcConfig(4).topology).toBe('mesh');
      expect(callsService.getWebRtcConfig(9).sfuRequired).toBe(true);
    });

    it('parses comma-separated TURN URLs across UDP/TCP/TLS and reports hasTurn=false without valid TURN', () => {
      mockConfigService.get.mockImplementation((key: string, defaultValue?: string) => {
        const env: Record<string, string> = {
          WEBRTC_TURN_SERVER_URL:
            'turn:relay.whatsapp.net:3478?transport=udp, turn:relay.whatsapp.net:3478?transport=tcp, turns:relay.whatsapp.net:5349?transport=tcp',
          WEBRTC_TURN_USERNAME: 'turnuser',
          WEBRTC_TURN_CREDENTIAL: 'turnpass',
        };
        return env[key] ?? defaultValue;
      });

      const multiConfig = callsController.getIceServers();
      expect(multiConfig.hasTurn).toBe(true);
      expect(multiConfig.iceServers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            urls: 'turn:relay.whatsapp.net:3478?transport=udp',
            username: 'turnuser',
            credential: 'turnpass',
          }),
          expect.objectContaining({
            urls: 'turn:relay.whatsapp.net:3478?transport=tcp',
            username: 'turnuser',
            credential: 'turnpass',
          }),
          expect.objectContaining({
            urls: 'turns:relay.whatsapp.net:5349?transport=tcp',
            username: 'turnuser',
            credential: 'turnpass',
          }),
        ]),
      );

      // Placeholder / missing TURN sets hasTurn=false
      mockConfigService.get.mockImplementation((key: string, defaultValue?: string) => {
        const env: Record<string, string> = {
          WEBRTC_TURN_SERVER_URL: 'turn:your-turn-server.example.com:3478',
        };
        return env[key] ?? defaultValue;
      });

      const noTurnConfig = callsController.getIceServers();
      expect(noTurnConfig.hasTurn).toBe(false);
      expect(noTurnConfig.iceServers).toHaveLength(2);
    });

    it('initiates a call, emits call_incoming, and prevents duplicate active call', async () => {
      mockPrismaService.conversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        members: [{ userId: 'u1' }, { userId: 'u2' }],
        group: null,
      });
      mockPrismaService.call.findFirst.mockResolvedValueOnce(null);
      mockPrismaService.call.create.mockResolvedValue({
        id: 'call-1',
        callerId: 'u1',
        conversationId: 'conv-1',
        callType: CallType.VIDEO,
        status: CallStatus.RINGING,
        caller: { id: 'u1', displayName: 'Alice' },
      });

      const initiated = await callsController.initiateCall('u1', {
        conversationId: 'conv-1',
        callType: CallType.VIDEO,
      });

      expect(initiated.call.id).toBe('call-1');
      expect(initiated.recipients).toEqual(['u2']);
      expect((callsService.getServer() as any).emitted).toContainEqual(
        expect.objectContaining({
          room: 'user:u2',
          event: 'call_incoming',
        }),
      );
      expect(mockNotificationsService.sendCallNotification).toHaveBeenCalled();

      // Duplicate active call rejected
      mockPrismaService.call.findFirst.mockResolvedValueOnce({ id: 'call-1' });
      await expect(
        callsService.initiateCall('u1', 'conv-1', CallType.AUDIO),
      ).rejects.toThrow(ConflictException);
    });

    it('relays SDP offer, SDP answer, and ICE candidates via CallsGateway', async () => {
      mockPrismaService.call.findUnique.mockResolvedValue({
        id: 'call-1',
        callerId: 'u1',
        conversationId: 'conv-1',
        participants: [{ userId: 'u1' }, { userId: 'u2' }],
      });

      const socketU1: any = { data: { userId: 'u1' }, join: jest.fn(), leave: jest.fn() };
      const socketU2: any = { data: { userId: 'u2' }, join: jest.fn(), leave: jest.fn() };

      await callsGateway.handleCallOffer(socketU1, {
        callId: 'call-1',
        toUserId: 'u2',
        sdp: { type: 'offer', sdp: 'v=0...' },
      });
      await callsGateway.handleCallAnswer(socketU2, {
        callId: 'call-1',
        toUserId: 'u1',
        sdp: { type: 'answer', sdp: 'v=0...' },
      });
      await callsGateway.handleIceCandidate(socketU1, {
        callId: 'call-1',
        toUserId: 'u2',
        candidate: { candidate: 'candidate:1 1 udp ...' },
      });

      const emitted = (callsService.getServer() as any).emitted;
      expect(emitted).toContainEqual(
        expect.objectContaining({ room: 'user:u2', event: 'call_offer_received' }),
      );
      expect(emitted).toContainEqual(
        expect.objectContaining({ room: 'user:u1', event: 'call_answer_received' }),
      );
      expect(emitted).toContainEqual(
        expect.objectContaining({ room: 'user:u2', event: 'ice_candidate_received' }),
      );
    });

    it('supports rejecting an incoming call and ending an ongoing call with duration', async () => {
      mockPrismaService.call.findUnique.mockResolvedValue({
        id: 'call-1',
        callerId: 'u1',
        conversationId: 'conv-1',
        status: CallStatus.RINGING,
        startedAt: null,
        participants: [{ userId: 'u1' }, { userId: 'u2' }],
      });
      mockPrismaService.conversationMember.count.mockResolvedValue(2);
      mockPrismaService.call.update.mockResolvedValue({
        id: 'call-1',
        status: CallStatus.REJECTED,
        durationSeconds: 0,
      });

      const rejected = await callsGateway.handleCallReject(
        { data: { userId: 'u2' } } as any,
        { callId: 'call-1' },
      );
      expect(rejected.status).toBe(CallStatus.REJECTED);
      expect((callsService.getServer() as any).emitted).toContainEqual(
        expect.objectContaining({ room: 'user:u1', event: 'call_rejected' }),
      );

      // Ongoing call end calculates durationSeconds
      const tenSecondsAgo = new Date(Date.now() - 10_000);
      mockPrismaService.call.findUnique.mockResolvedValue({
        id: 'call-2',
        callerId: 'u1',
        conversationId: 'conv-1',
        status: CallStatus.ONGOING,
        startedAt: tenSecondsAgo,
        participants: [{ userId: 'u1' }, { userId: 'u2' }],
      });
      mockPrismaService.callParticipant.count.mockResolvedValue(1);
      mockPrismaService.call.update.mockImplementation(async ({ data }: any) => ({
        id: 'call-2',
        ...data,
      }));

      const ended = await callsGateway.handleCallEnd(
        { data: { userId: 'u1' }, leave: jest.fn() } as any,
        { callId: 'call-2' },
      );
      expect(ended.status).toBe(CallStatus.ENDED);
      expect(ended.durationSeconds).toBeGreaterThanOrEqual(9);
      expect((callsService.getServer() as any).emitted).toContainEqual(
        expect.objectContaining({ room: 'call:call-2', event: 'call_ended' }),
      );
    });
  });
});

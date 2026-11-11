import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CallStatus, CallType } from '@prisma/client';
import { Server } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * WebRTC Topology Notes:
 * - 2 participants: Peer-to-peer (P2P) direct RTCPeerConnection.
 * - 3 to 8 participants: Full-mesh topology where each peer establishes a direct
 *   RTCPeerConnection with every other participant in the `call:{callId}` room.
 * - >8 participants: Full-mesh requires N*(N-1)/2 peer connections and saturates client
 *   uplink bandwidth/CPU; a Selective Forwarding Unit (SFU) media server such as
 *   `mediasoup` or `LiveKit` is required for >8 concurrent participants.
 */
export const MAX_MESH_PARTICIPANTS = 8;
const CALL_REDIS_TTL_SECONDS = 60 * 60 * 6; // 6 hours

@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);
  private server: Server | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
    private readonly notificationsService: NotificationsService,
  ) {}

  setServer(server: Server): void {
    this.server = server;
  }

  getServer(): Server | null {
    return this.server;
  }

  /**
   * Build STUN/TURN ICE server configuration from environment variables
   * (`WEBRTC_TURN_SERVER_URL`, `WEBRTC_TURN_USERNAME`, `WEBRTC_TURN_CREDENTIAL`).
   * Supports comma-separated TURN URLs for multiple transports (UDP/TCP/TLS).
   */
  getIceServers(): IceServerConfig[] {
    const iceServers: IceServerConfig[] = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ];

    const turnUrlRaw = this.configService.get<string>('WEBRTC_TURN_SERVER_URL');
    const turnUsername = this.configService.get<string>('WEBRTC_TURN_USERNAME');
    const turnCredential = this.configService.get<string>('WEBRTC_TURN_CREDENTIAL');

    if (turnUrlRaw) {
      const turnUrls = turnUrlRaw
        .split(',')
        .map((url) => url.trim())
        .filter(
          (url) =>
            url.length > 0 &&
            !url.includes('example.com') &&
            !url.includes('your-turn-server'),
        );

      for (const url of turnUrls) {
        const turnConfig: IceServerConfig = { urls: url };
        if (turnUsername) {
          turnConfig.username = turnUsername;
        }
        if (turnCredential) {
          turnConfig.credential = turnCredential;
        }
        iceServers.push(turnConfig);
      }
    }

    return iceServers;
  }

  getWebRtcConfig(participantCount = 2) {
    const iceServers = this.getIceServers();
    const hasTurn = iceServers.some((server) => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      return urls.some((url) => url.startsWith('turn:') || url.startsWith('turns:'));
    });

    return {
      iceServers,
      hasTurn,
      topology: participantCount > 2 ? 'mesh' : 'p2p',
      maxMeshParticipants: MAX_MESH_PARTICIPANTS,
      sfuRequired: participantCount > MAX_MESH_PARTICIPANTS,
      sfuNote:
        participantCount > MAX_MESH_PARTICIPANTS
          ? 'Group calls exceeding 8 participants require an SFU media server (e.g., mediasoup) instead of mesh topology.'
          : undefined,
    };
  }

  /**
   * Initiate a 1-on-1 or group WebRTC call in a conversation.
   */
  async initiateCall(
    callerId: string,
    conversationId: string,
    callType: CallType,
  ) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        members: {
          where: { isActive: true, leftAt: null },
          include: {
            user: {
              select: {
                id: true,
                displayName: true,
                avatarUrl: true,
                phoneNumber: true,
              },
            },
          },
        },
        group: {
          select: { id: true, name: true, avatarUrl: true },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const isMember = conversation.members.some((m) => m.userId === callerId);
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this conversation');
    }

    const existingActiveCall = await this.prisma.call.findFirst({
      where: {
        conversationId,
        status: { in: [CallStatus.INITIATED, CallStatus.RINGING, CallStatus.ONGOING] },
      },
    });

    if (existingActiveCall) {
      throw new ConflictException(
        `An active call (${existingActiveCall.id}) already exists in this conversation`,
      );
    }

    const call = await this.prisma.$transaction(async (tx) => {
      const createdCall = await tx.call.create({
        data: {
          callerId,
          conversationId,
          callType,
          status: CallStatus.RINGING,
        },
        include: {
          caller: {
            select: {
              id: true,
              displayName: true,
              avatarUrl: true,
              phoneNumber: true,
            },
          },
        },
      });

      await tx.callParticipant.create({
        data: {
          callId: createdCall.id,
          userId: callerId,
          joinedAt: new Date(),
          isVideoOn: callType === CallType.VIDEO,
        },
      });

      return createdCall;
    });

    await this.redis.sadd(`call:peers:${call.id}`, callerId);
    await this.redis.expire(`call:peers:${call.id}`, CALL_REDIS_TTL_SECONDS);

    const memberCount = conversation.members.length;
    const webrtcConfig = this.getWebRtcConfig(memberCount);
    const recipientIds = conversation.members
      .map((m) => m.userId)
      .filter((id) => id !== callerId);

    const incomingPayload = {
      callId: call.id,
      call,
      callerId,
      caller: call.caller,
      conversationId,
      callType,
      group: conversation.group,
      participantCount: memberCount,
      ...webrtcConfig,
    };

    // Emit 'call_incoming' directly to each conversation member's user room
    for (const memberId of recipientIds) {
      this.emitToUser(memberId, 'call_incoming', incomingPayload);
    }

    // Dispatch push notifications (including conversationId for deep linking)
    await this.notificationsService.sendCallNotification(
      {
        id: call.id,
        callerId: call.callerId,
        callType: call.callType,
        conversationId: call.conversationId,
        caller: call.caller,
      },
      recipientIds,
    );

    return {
      call,
      ...webrtcConfig,
      recipients: recipientIds,
    };
  }

  /**
   * Join an active call, create/update call_participant record,
   * and emit 'call_signal' to existing peers for mesh WebRTC connection setup.
   */
  async joinCall(callId: string, userId: string) {
    const call = await this.assertCallAccess(callId, userId);

    if (
      call.status === CallStatus.ENDED ||
      call.status === CallStatus.REJECTED ||
      call.status === CallStatus.MISSED
    ) {
      throw new BadRequestException(`Call is already ${call.status.toLowerCase()}`);
    }

    const activeParticipantsBeforeJoin = await this.prisma.callParticipant.findMany({
      where: {
        callId,
        leftAt: null,
        userId: { not: userId },
      },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    });

    const totalProjected = activeParticipantsBeforeJoin.length + 1;
    if (totalProjected > MAX_MESH_PARTICIPANTS) {
      this.logger.warn(
        `Call ${callId} has ${totalProjected} participants (> ${MAX_MESH_PARTICIPANTS}). ` +
          'Mesh topology degrades beyond 8 peers; an SFU (e.g., mediasoup) is needed.',
      );
    }

    const now = new Date();
    const participant = await this.prisma.callParticipant.upsert({
      where: {
        callId_userId: { callId, userId },
      },
      create: {
        callId,
        userId,
        joinedAt: now,
        leftAt: null,
        isVideoOn: call.callType === CallType.VIDEO,
      },
      update: {
        joinedAt: now,
        leftAt: null,
      },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    });

    const updatedCall = await this.prisma.call.update({
      where: { id: callId },
      data: {
        status: CallStatus.ONGOING,
        startedAt: call.startedAt ?? now,
      },
    });

    await this.redis.sadd(`call:peers:${callId}`, userId);
    await this.redis.expire(`call:peers:${callId}`, CALL_REDIS_TTL_SECONDS);

    const activePeerIds = activeParticipantsBeforeJoin.map((p) => p.userId);
    const topology = totalProjected > 2 ? 'mesh' : 'p2p';

    // Notify existing peers in call:{callId} so each peer establishes a mesh RTCPeerConnection
    this.emitToCallRoom(
      callId,
      'call_signal',
      {
        callId,
        fromUserId: userId,
        type: 'peer_joined',
        topology,
        activePeerIds,
        participant,
      },
      userId,
    );

    return {
      call: updatedCall,
      participant,
      activePeers: activeParticipantsBeforeJoin,
      ...this.getWebRtcConfig(totalProjected),
    };
  }

  /**
   * End an active call for the user (and terminate the call if <=1 active peer remains
   * or if it's a 1-on-1 call). Updates ended_at and durationSeconds.
   */
  async endCall(callId: string, userId: string) {
    const call = await this.assertCallAccess(callId, userId);

    if (
      call.status === CallStatus.ENDED ||
      call.status === CallStatus.REJECTED ||
      call.status === CallStatus.MISSED
    ) {
      return call;
    }

    const now = new Date();

    await this.prisma.callParticipant.updateMany({
      where: { callId, userId, leftAt: null },
      data: { leftAt: now },
    });

    await this.redis.srem(`call:peers:${callId}`, userId);

    const remainingActive = await this.prisma.callParticipant.count({
      where: { callId, leftAt: null },
    });

    const shouldCloseCall =
      remainingActive <= 1 || call.status === CallStatus.RINGING;

    let finalCall = call;
    if (shouldCloseCall) {
      const wasAnswered = Boolean(call.startedAt);
      const durationSeconds = call.startedAt
        ? Math.max(0, Math.floor((now.getTime() - call.startedAt.getTime()) / 1000))
        : 0;

      await this.prisma.callParticipant.updateMany({
        where: { callId, leftAt: null },
        data: { leftAt: now },
      });

      finalCall = await this.prisma.call.update({
        where: { id: callId },
        data: {
          status: wasAnswered ? CallStatus.ENDED : CallStatus.MISSED,
          endedAt: now,
          durationSeconds,
        },
        include: { participants: true },
      });

      await this.redis.del(`call:peers:${callId}`);

      const endPayload = {
        callId,
        endedBy: userId,
        conversationId: call.conversationId,
        status: finalCall.status,
        endedAt: now.toISOString(),
        durationSeconds,
      };

      this.emitToCallRoom(callId, 'call_ended', endPayload);
      this.emitToCallRoom(callId, 'call_ended_notification', endPayload);

      if (call.conversationId) {
        this.emitToConversation(call.conversationId, 'call_ended', endPayload);
        this.emitToConversation(
          call.conversationId,
          'call_ended_notification',
          endPayload,
        );
      }
    } else {
      // Group mesh call continues for remaining participants
      this.emitToCallRoom(
        callId,
        'call_signal',
        {
          callId,
          fromUserId: userId,
          type: 'peer_left',
          leftAt: now.toISOString(),
        },
        userId,
      );
    }

    return finalCall;
  }

  /**
   * Reject an incoming call and notify the caller.
   */
  async rejectCall(callId: string, userId: string) {
    const call = await this.assertCallAccess(callId, userId);

    if (call.callerId === userId) {
      throw new BadRequestException('Caller cannot reject their own call; end it instead');
    }

    if (
      call.status === CallStatus.ENDED ||
      call.status === CallStatus.REJECTED ||
      call.status === CallStatus.MISSED
    ) {
      return call;
    }

    let memberCount = 2;
    if (call.conversationId) {
      memberCount = await this.prisma.conversationMember.count({
        where: {
          conversationId: call.conversationId,
          isActive: true,
          leftAt: null,
        },
      });
    }

    const now = new Date();
    let updatedCall = call;

    // For 1-on-1 calls (or unstarted group calls with <=2 members), mark REJECTED immediately
    if (memberCount <= 2) {
      updatedCall = await this.prisma.call.update({
        where: { id: callId },
        data: {
          status: CallStatus.REJECTED,
          endedAt: now,
          durationSeconds: 0,
        },
        include: { participants: true },
      });
      await this.redis.del(`call:peers:${callId}`);
    }

    const rejectPayload = {
      callId,
      rejectedBy: userId,
      callerId: call.callerId,
      conversationId: call.conversationId,
      status: updatedCall.status,
      rejectedAt: now.toISOString(),
    };

    this.emitToUser(call.callerId, 'call_rejected', rejectPayload);
    this.emitToCallRoom(callId, 'call_rejected', rejectPayload);

    return updatedCall;
  }

  /**
   * Pure WebRTC signaling relay for SDP offers/answers and ICE candidates.
   * Server never terminates media; it only routes signaling messages in mesh/P2P topology.
   */
  async handleSignal(
    callId: string,
    fromUserId: string,
    toUserId: string | undefined,
    signalData: {
      event?: string;
      type?: string;
      offer?: unknown;
      answer?: unknown;
      sdp?: unknown;
      candidate?: unknown;
      signal?: unknown;
    },
  ) {
    await this.assertCallAccess(callId, fromUserId);

    const payload = {
      callId,
      fromUserId,
      toUserId,
      ...signalData,
    };

    const eventName =
      signalData.event ??
      (signalData.type === 'offer'
        ? 'call_offer_received'
        : signalData.type === 'answer'
          ? 'call_answer_received'
          : signalData.type === 'ice_candidate' || signalData.type === 'ice-candidate'
            ? 'ice_candidate_received'
            : 'call_signal');

    if (toUserId) {
      this.emitToUser(toUserId, eventName, payload);
    } else {
      this.emitToCallRoom(callId, eventName, payload, fromUserId);
    }

    return { relayed: true, event: eventName, callId };
  }

  /**
   * Paginated call history for the authenticated user.
   */
  async getCallHistory(userId: string, cursor?: string, limit = 20) {
    const take = Math.min(Math.max(limit, 1), 100);

    const rows = await this.prisma.call.findMany({
      where: {
        OR: [
          { callerId: userId },
          { participants: { some: { userId } } },
          {
            conversation: {
              members: { some: { userId, isActive: true } },
            },
          },
        ],
      },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: {
        caller: {
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
            phoneNumber: true,
          },
        },
        participants: {
          include: {
            user: {
              select: {
                id: true,
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
        conversation: {
          select: {
            id: true,
            type: true,
            group: {
              select: { id: true, name: true, avatarUrl: true },
            },
          },
        },
      },
    });

    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return {
      items,
      nextCursor,
      hasMore,
    };
  }

  /**
   * Return the user's current active call (INITIATED / RINGING / ONGOING), if any.
   */
  async getActiveCall(userId: string) {
    const activeCall = await this.prisma.call.findFirst({
      where: {
        status: { in: [CallStatus.INITIATED, CallStatus.RINGING, CallStatus.ONGOING] },
        OR: [
          { callerId: userId },
          { participants: { some: { userId, leftAt: null } } },
          {
            conversation: {
              members: { some: { userId, isActive: true, leftAt: null } },
            },
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        caller: {
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
            phoneNumber: true,
          },
        },
        participants: {
          where: { leftAt: null },
          include: {
            user: {
              select: {
                id: true,
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
        conversation: {
          select: {
            id: true,
            type: true,
            group: {
              select: { id: true, name: true, avatarUrl: true },
            },
          },
        },
      },
    });

    if (!activeCall) {
      return null;
    }

    return {
      ...activeCall,
      ...this.getWebRtcConfig(activeCall.participants.length),
    };
  }

  async updateParticipantMedia(
    callId: string,
    userId: string,
    updates: { isMuted?: boolean; isVideoOn?: boolean },
  ) {
    await this.assertCallAccess(callId, userId);

    const participant = await this.prisma.callParticipant.updateMany({
      where: { callId, userId },
      data: {
        ...(updates.isMuted !== undefined ? { isMuted: updates.isMuted } : {}),
        ...(updates.isVideoOn !== undefined ? { isVideoOn: updates.isVideoOn } : {}),
      },
    });

    this.emitToCallRoom(
      callId,
      'call_signal',
      {
        callId,
        fromUserId: userId,
        type: 'media_state',
        ...updates,
      },
      userId,
    );

    return participant;
  }

  async assertCallAccess(callId: string, userId: string) {
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      include: {
        participants: true,
      },
    });

    if (!call) {
      throw new NotFoundException('Call not found');
    }

    if (call.callerId === userId) {
      return call;
    }

    const isParticipant = call.participants.some((p) => p.userId === userId);
    if (isParticipant) {
      return call;
    }

    if (call.conversationId) {
      const membership = await this.prisma.conversationMember.findFirst({
        where: {
          conversationId: call.conversationId,
          userId,
          isActive: true,
          leftAt: null,
        },
      });
      if (membership) {
        return call;
      }
    }

    throw new ForbiddenException('You do not have access to this call');
  }

  private emitToUser(userId: string, event: string, data: unknown): void {
    if (!this.server) {
      return;
    }
    this.server.to(`user:${userId}`).emit(event, data);
  }

  private emitToConversation(conversationId: string, event: string, data: unknown): void {
    if (!this.server) {
      return;
    }
    this.server.to(`conversation:${conversationId}`).emit(event, data);
  }

  private emitToCallRoom(
    callId: string,
    event: string,
    data: unknown,
    excludeUserId?: string,
  ): void {
    if (!this.server) {
      return;
    }
    if (excludeUserId) {
      this.server
        .to(`call:${callId}`)
        .except(`user:${excludeUserId}`)
        .emit(event, data);
      return;
    }
    this.server.to(`call:${callId}`).emit(event, data);
  }
}

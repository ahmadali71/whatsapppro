import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
  WsException,
} from '@nestjs/websockets';
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { MessageType } from '@prisma/client';
import { SocketEvents } from '../shared-types';
import { GatewayService } from './gateway.service';
import { ChatsService } from '../chats/chats.service';
import { CreateMessageDto } from '../chats/dto/create-message.dto';
import { createCorsOriginOption } from '../common/cors.util';

interface JwtPayload {
  sub?: string;
  id?: string;
  userId?: string;
}

interface ConversationRoomPayload {
  conversationId: string;
}

interface SendMessageSocketPayload {
  conversationId: string;
  content?: string;
  messageType?: MessageType;
  replyToId?: string;
  isViewOnce?: boolean;
  isEncrypted?: boolean;
  encryptionMetadata?: Record<string, any>;
  attachmentUrl?: string;
  attachmentName?: string;
  attachmentSize?: number;
  mimeType?: string;
  duration?: number;
  width?: number;
  height?: number;
  thumbnailUrl?: string;
  latitude?: number;
  longitude?: number;
  contactName?: string;
  contactPhone?: string;
}

interface ReceiptPayload {
  messageId: string;
  conversationId?: string;
}

interface CallRoomPayload {
  callId: string;
  conversationId?: string;
  targetUserId?: string;
  callType?: 'AUDIO' | 'VIDEO';
}

interface CallSignalPayload {
  callId: string;
  targetUserId?: string;
  type?: 'offer' | 'answer' | 'ice-candidate' | string;
  signal: unknown;
}

interface LiveLocationPayload {
  conversationId: string;
  messageId?: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  heading?: number;
  speed?: number;
  expiresAt?: string;
}

@WebSocketGateway({
  cors: {
    origin: createCorsOriginOption(),
    credentials: true,
  },
  namespace: '/',
})
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly gatewayService: GatewayService,
    @Inject(forwardRef(() => ChatsService))
    private readonly chatsService: ChatsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  afterInit(server: Server): void {
    this.gatewayService.setServer(server);
    this.logger.log('ChatGateway WebSocket server initialized on namespace "/"');
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const userId = this.authenticateSocket(client);
      client.data.userId = userId;

      // Personal room for direct user-targeted notifications & offline queue flush
      await client.join(`user:${userId}`);

      // Join all active conversation rooms for this user
      const conversationIds = await this.chatsService.getUserConversationIds(userId);
      await Promise.all(
        conversationIds.map((id) => client.join(`conversation:${id}`)),
      );

      // Track online presence in Redis (TTL 24h)
      await this.gatewayService.setUserOnline(userId, client.id);

      // Broadcast online status to user's conversations
      this.broadcastPresence(conversationIds, 'user_online', {
        userId,
        isOnline: true,
        timestamp: new Date().toISOString(),
      });

      // Deliver queued offline messages/events on reconnect
      const queued = await this.gatewayService.flushOfflineQueue(userId);
      for (const item of queued) {
        client.emit(item.event, item.data);
      }

      this.logger.debug(`Socket connected: user=${userId}, socket=${client.id}`);
    } catch (error) {
      this.logger.warn(
        `Rejected unauthorized socket ${client.id}: ${(error as Error).message}`,
      );
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const userId: string | undefined = client.data?.userId;
    if (!userId) return;

    const lastSeen = await this.gatewayService.setUserOffline(userId);
    const conversationIds = await this.chatsService.getUserConversationIds(userId);

    this.broadcastPresence(conversationIds, 'user_offline', {
      userId,
      isOnline: false,
      lastSeen: lastSeen.toISOString(),
    });

    this.logger.debug(`Socket disconnected: user=${userId}, socket=${client.id}`);
  }

  // ─────────────────────────── Conversation Rooms ──────────────────────────

  @SubscribeMessage('join_conversation')
  async handleJoinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ConversationRoomPayload,
  ) {
    return this.joinConversationRoom(client, payload);
  }

  @SubscribeMessage(SocketEvents.CONVERSATION_JOIN)
  async handleJoinConversationAlias(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ConversationRoomPayload,
  ) {
    return this.joinConversationRoom(client, payload);
  }

  private async joinConversationRoom(
    client: Socket,
    payload: ConversationRoomPayload,
  ) {
    const userId = this.getAuthenticatedUserId(client);
    const { conversationId } = payload ?? {};
    if (!conversationId) {
      throw new WsException('conversationId is required');
    }

    await this.assertConversationMembership(conversationId, userId);
    await client.join(`conversation:${conversationId}`);

    return { joined: true, conversationId };
  }

  @SubscribeMessage('leave_conversation')
  async handleLeaveConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ConversationRoomPayload,
  ) {
    return this.leaveConversationRoom(client, payload);
  }

  @SubscribeMessage(SocketEvents.CONVERSATION_LEAVE)
  async handleLeaveConversationAlias(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ConversationRoomPayload,
  ) {
    return this.leaveConversationRoom(client, payload);
  }

  private async leaveConversationRoom(
    client: Socket,
    payload: ConversationRoomPayload,
  ) {
    const userId = this.getAuthenticatedUserId(client);
    const { conversationId } = payload ?? {};
    if (!conversationId) {
      throw new WsException('conversationId is required');
    }

    await this.assertConversationMembership(conversationId, userId);
    await client.leave(`conversation:${conversationId}`);
    await this.gatewayService.setTyping(conversationId, userId, false);

    return { left: true, conversationId };
  }

  // ─────────────────────────── Messaging ───────────────────────────────────

  @SubscribeMessage('send_message')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SendMessageSocketPayload,
  ) {
    return this.processSendMessage(client, payload);
  }

  @SubscribeMessage(SocketEvents.MESSAGE_SEND)
  async handleSendMessageAlias(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SendMessageSocketPayload,
  ) {
    return this.processSendMessage(client, payload);
  }

  private async processSendMessage(
    client: Socket,
    payload: SendMessageSocketPayload,
  ) {
    const userId = this.getAuthenticatedUserId(client);
    const { conversationId, ...rest } = payload ?? {};
    if (!conversationId) {
      throw new WsException('conversationId is required');
    }

    await this.assertConversationMembership(conversationId, userId);

    const dto: CreateMessageDto = {
      messageType: rest.messageType ?? MessageType.TEXT,
      content: rest.content,
      replyToId: rest.replyToId,
      isViewOnce: rest.isViewOnce ?? false,
      isEncrypted: rest.isEncrypted ?? false,
      encryptionMetadata: rest.encryptionMetadata,
      attachmentUrl: rest.attachmentUrl,
      attachmentName: rest.attachmentName,
      attachmentSize: rest.attachmentSize,
      mimeType: rest.mimeType,
      duration: rest.duration,
      width: rest.width,
      height: rest.height,
      thumbnailUrl: rest.thumbnailUrl,
      latitude: rest.latitude,
      longitude: rest.longitude,
      contactName: rest.contactName,
      contactPhone: rest.contactPhone,
    };

    // ChatsService persists, updates unread counts, queues offline recipients,
    // and broadcasts 'new_message' to `conversation:${conversationId}`.
    const message = await this.chatsService.sendMessage(userId, conversationId, dto);
    return { status: 'ok', message };
  }

  // ─────────────────────────── Typing Indicators ───────────────────────────

  @SubscribeMessage('typing_start')
  async handleTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ConversationRoomPayload,
  ) {
    return this.processTyping(client, payload, true);
  }

  @SubscribeMessage(SocketEvents.TYPING_START)
  async handleTypingStartAlias(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ConversationRoomPayload,
  ) {
    return this.processTyping(client, payload, true);
  }

  @SubscribeMessage('typing_stop')
  async handleTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ConversationRoomPayload,
  ) {
    return this.processTyping(client, payload, false);
  }

  @SubscribeMessage(SocketEvents.TYPING_STOP)
  async handleTypingStopAlias(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ConversationRoomPayload,
  ) {
    return this.processTyping(client, payload, false);
  }

  private async processTyping(
    client: Socket,
    payload: ConversationRoomPayload,
    isTyping: boolean,
  ) {
    const userId = this.getAuthenticatedUserId(client);
    const { conversationId } = payload ?? {};
    if (!conversationId) {
      throw new WsException('conversationId is required');
    }

    await this.assertConversationMembership(conversationId, userId);
    await this.gatewayService.setTyping(conversationId, userId, isTyping);

    client.to(`conversation:${conversationId}`).emit('typing_indicator', {
      userId,
      conversationId,
      isTyping,
    });

    return { ok: true };
  }

  // ─────────────────────────── Delivery & Read Receipts ────────────────────

  @SubscribeMessage('message_delivered')
  async handleMessageDelivered(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ReceiptPayload,
  ) {
    return this.processMessageDelivered(client, payload);
  }

  @SubscribeMessage(SocketEvents.MESSAGE_DELIVERED)
  async handleMessageDeliveredAlias(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ReceiptPayload,
  ) {
    return this.processMessageDelivered(client, payload);
  }

  private async processMessageDelivered(client: Socket, payload: ReceiptPayload) {
    const userId = this.getAuthenticatedUserId(client);
    if (!payload?.messageId) {
      throw new WsException('messageId is required');
    }

    const receipt = await this.chatsService.markAsDelivered(userId, payload.messageId);
    this.gatewayService.broadcastToConversation(
      receipt.conversationId,
      'message_receipt',
      receipt,
    );
    return receipt;
  }

  @SubscribeMessage('message_read')
  async handleMessageRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ReceiptPayload,
  ) {
    return this.processMessageRead(client, payload);
  }

  @SubscribeMessage(SocketEvents.MESSAGE_READ)
  async handleMessageReadAlias(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ReceiptPayload,
  ) {
    return this.processMessageRead(client, payload);
  }

  private async processMessageRead(client: Socket, payload: ReceiptPayload) {
    const userId = this.getAuthenticatedUserId(client);
    if (!payload?.messageId || !payload?.conversationId) {
      throw new WsException('conversationId and messageId are required');
    }

    await this.assertConversationMembership(payload.conversationId, userId);
    const receipt = await this.chatsService.markAsRead(
      userId,
      payload.conversationId,
      payload.messageId,
    );

    this.gatewayService.broadcastToConversation(
      payload.conversationId,
      'message_receipt',
      receipt,
    );
    return receipt;
  }

  // ─────────────────────────── Presence ────────────────────────────────────

  @SubscribeMessage('mark_online')
  async handleMarkOnline(@ConnectedSocket() client: Socket) {
    const userId = this.getAuthenticatedUserId(client);
    await this.gatewayService.setUserOnline(userId, client.id);

    const conversationIds = await this.chatsService.getUserConversationIds(userId);
    this.broadcastPresence(conversationIds, 'user_online', {
      userId,
      isOnline: true,
      timestamp: new Date().toISOString(),
    });

    return { online: true };
  }

  @SubscribeMessage('mark_offline')
  async handleMarkOffline(@ConnectedSocket() client: Socket) {
    const userId = this.getAuthenticatedUserId(client);
    const lastSeen = await this.gatewayService.setUserOffline(userId);

    const conversationIds = await this.chatsService.getUserConversationIds(userId);
    this.broadcastPresence(conversationIds, 'user_offline', {
      userId,
      isOnline: false,
      lastSeen: lastSeen.toISOString(),
    });

    return { online: false, lastSeen };
  }

  // ─────────────────────────── Live Location ───────────────────────────────

  @SubscribeMessage('live_location_update')
  async handleLiveLocationUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: LiveLocationPayload,
  ) {
    const userId = this.getAuthenticatedUserId(client);
    const { conversationId, messageId, latitude, longitude, accuracy, heading, speed, expiresAt } =
      payload ?? {};

    if (!conversationId || typeof latitude !== 'number' || typeof longitude !== 'number') {
      throw new WsException('conversationId, latitude, and longitude are required');
    }

    await this.assertConversationMembership(conversationId, userId);

    const locationEvent = {
      conversationId,
      messageId,
      userId,
      latitude,
      longitude,
      accuracy,
      heading,
      speed,
      expiresAt,
      updatedAt: new Date().toISOString(),
    };

    await this.gatewayService.setLiveLocation(conversationId, userId, locationEvent);
    client.to(`conversation:${conversationId}`).emit('live_location_update', locationEvent);

    return { ok: true };
  }

  // ─────────────────────────── WebRTC Call Signaling ───────────────────────

  @SubscribeMessage('join_call')
  async handleJoinCall(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CallRoomPayload,
  ) {
    const userId = this.getAuthenticatedUserId(client);
    const { callId, conversationId, targetUserId, callType } = payload ?? {};
    if (!callId) {
      throw new WsException('callId is required');
    }

    if (conversationId) {
      await this.assertConversationMembership(conversationId, userId);
    }

    await client.join(`call:${callId}`);

    if (targetUserId) {
      this.gatewayService.emitToUser(targetUserId, 'call_incoming', {
        callId,
        callerId: userId,
        conversationId,
        callType: callType ?? 'AUDIO',
      });
    } else if (conversationId) {
      client.to(`conversation:${conversationId}`).emit('call_incoming', {
        callId,
        callerId: userId,
        conversationId,
        callType: callType ?? 'AUDIO',
      });
    }

    client.to(`call:${callId}`).emit('call_signal_relay', {
      callId,
      fromUserId: userId,
      type: 'participant_joined',
      signal: { userId },
    });

    return { joined: true, callId };
  }

  @SubscribeMessage('call_signal')
  async handleCallSignal(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CallSignalPayload,
  ) {
    const userId = this.getAuthenticatedUserId(client);
    const { callId, targetUserId, type, signal } = payload ?? {};
    if (!callId || signal === undefined) {
      throw new WsException('callId and signal are required');
    }

    const relayData = {
      callId,
      fromUserId: userId,
      type,
      signal,
    };

    if (targetUserId) {
      this.gatewayService.emitToUser(targetUserId, 'call_signal_relay', relayData);
    } else {
      client.to(`call:${callId}`).emit('call_signal_relay', relayData);
    }

    return { relayed: true };
  }

  @SubscribeMessage('leave_call')
  async handleLeaveCall(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CallRoomPayload,
  ) {
    const userId = this.getAuthenticatedUserId(client);
    const { callId, conversationId } = payload ?? {};
    if (!callId) {
      throw new WsException('callId is required');
    }

    if (conversationId) {
      await this.assertConversationMembership(conversationId, userId);
    }

    await client.leave(`call:${callId}`);

    const endData = {
      callId,
      userId,
      conversationId,
      endedAt: new Date().toISOString(),
    };
    this.server.to(`call:${callId}`).emit('call_ended', endData);
    if (conversationId) {
      this.server.to(`conversation:${conversationId}`).emit('call_ended', endData);
    }

    return { left: true, callId };
  }

  // ─────────────────────────── Group Event Emitters ────────────────────────

  emitGroupUpdated(conversationId: string, groupData: unknown): void {
    this.gatewayService.broadcastToConversation(conversationId, 'group_updated', {
      conversationId,
      group: groupData,
    });
  }

  emitMemberAdded(conversationId: string, memberData: unknown): void {
    this.gatewayService.broadcastToConversation(conversationId, 'member_added', {
      conversationId,
      member: memberData,
    });
  }

  emitMemberRemoved(conversationId: string, userId: string): void {
    this.gatewayService.broadcastToConversation(conversationId, 'member_removed', {
      conversationId,
      userId,
    });
  }

  // ─────────────────────────── Auth & Helpers ──────────────────────────────

  private authenticateSocket(client: Socket): string {
    const rawAuthToken =
      (client.handshake.auth?.token as string | undefined) ??
      (client.handshake.headers?.authorization as string | undefined);

    if (!rawAuthToken) {
      throw new Error('Missing authentication token');
    }

    const token = rawAuthToken.startsWith('Bearer ')
      ? rawAuthToken.slice(7).trim()
      : rawAuthToken.trim();

    if (!token) {
      throw new Error('Empty authentication token');
    }

    const secret = this.configService.get<string>('JWT_SECRET', 'dev-jwt-secret');
    const payload = this.jwtService.verify<JwtPayload>(token, { secret });
    const userId = payload.sub ?? payload.id ?? payload.userId;

    if (!userId) {
      throw new Error('Token missing user identifier');
    }

    return userId;
  }

  private getAuthenticatedUserId(client: Socket): string {
    const userId: string | undefined = client.data?.userId;
    if (!userId) {
      throw new WsException('Unauthorized');
    }
    return userId;
  }

  private async assertConversationMembership(
    conversationId: string,
    userId: string,
  ): Promise<void> {
    const isMember = await this.chatsService.isConversationMember(
      conversationId,
      userId,
    );
    if (!isMember) {
      throw new WsException('Forbidden: Not a member of this conversation');
    }
  }

  private broadcastPresence(
    conversationIds: string[],
    event: 'user_online' | 'user_offline',
    data: unknown,
  ): void {
    for (const conversationId of conversationIds) {
      this.gatewayService.broadcastToConversation(conversationId, event, data);
    }
  }
}

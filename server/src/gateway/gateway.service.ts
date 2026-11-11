import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const ONLINE_TTL_SECONDS = 86400; // 24 hours
const TYPING_TTL_SECONDS = 5; // 5 seconds
const OFFLINE_QUEUE_TTL_SECONDS = 86400 * 7; // 7 days

export interface QueuedOfflineEvent {
  event: string;
  conversationId?: string;
  messageId?: string;
  data: unknown;
  queuedAt: string;
}

@Injectable()
export class GatewayService {
  private readonly logger = new Logger(GatewayService.name);
  private server: Server | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  setServer(server: Server): void {
    this.server = server;
  }

  getServer(): Server | null {
    return this.server;
  }

  /**
   * Mark user online in Redis (`online:{userId}` = socketId, TTL 24h)
   * and sync UserProfile in PostgreSQL.
   */
  async setUserOnline(userId: string, socketId: string): Promise<void> {
    try {
      await this.redis.set(`online:${userId}`, socketId, ONLINE_TTL_SECONDS);
    } catch (error) {
      this.logger.warn(`Failed to set online key for ${userId}: ${(error as Error).message}`);
    }

    try {
      await this.prisma.userProfile.upsert({
        where: { userId },
        create: { userId, isOnline: true, lastSeen: new Date() },
        update: { isOnline: true },
      });
    } catch (error) {
      this.logger.warn(`Failed to sync online status for ${userId}: ${(error as Error).message}`);
    }
  }

  /**
   * Mark user offline in Redis and update `lastSeen` in UserProfile.
   */
  async setUserOffline(userId: string): Promise<Date> {
    const lastSeen = new Date();
    try {
      await this.redis.del(`online:${userId}`);
    } catch (error) {
      this.logger.warn(`Failed to delete online key for ${userId}: ${(error as Error).message}`);
    }

    try {
      await this.prisma.userProfile.upsert({
        where: { userId },
        create: { userId, isOnline: false, lastSeen },
        update: { isOnline: false, lastSeen, isTypingInConversationId: null },
      });
    } catch (error) {
      this.logger.warn(`Failed to sync offline status for ${userId}: ${(error as Error).message}`);
    }

    return lastSeen;
  }

  /**
   * Check whether a user currently has an active socket entry in Redis.
   */
  async isUserOnline(userId: string): Promise<boolean> {
    try {
      const exists = await this.redis.exists(`online:${userId}`);
      return exists === 1;
    } catch (error) {
      this.logger.warn(`Failed to check online status for ${userId}: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Retrieve the socket ID stored for a user in Redis.
   */
  async getUserSocket(userId: string): Promise<string | null> {
    try {
      return await this.redis.get(`online:${userId}`);
    } catch (error) {
      this.logger.warn(`Failed to get socket for ${userId}: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Track typing indicator in Redis (`typing:{conversationId}:{userId}`, TTL 5s).
   */
  async setTyping(conversationId: string, userId: string, isTyping: boolean): Promise<void> {
    const key = `typing:${conversationId}:${userId}`;
    try {
      if (isTyping) {
        await this.redis.set(key, '1', TYPING_TTL_SECONDS);
      } else {
        await this.redis.del(key);
      }
    } catch (error) {
      this.logger.warn(`Failed to update typing key ${key}: ${(error as Error).message}`);
    }
  }

  /**
   * Store latest live location coordinates for a user in a conversation in Redis (TTL 1h).
   */
  async setLiveLocation(
    conversationId: string,
    userId: string,
    data: {
      messageId?: string;
      latitude: number;
      longitude: number;
      accuracy?: number;
      heading?: number;
      speed?: number;
      expiresAt?: string;
    },
  ): Promise<void> {
    const key = `live_location:${conversationId}:${userId}`;
    try {
      await this.redis.set(
        key,
        JSON.stringify({ ...data, userId, conversationId, updatedAt: new Date().toISOString() }),
        3600,
      );
    } catch (error) {
      this.logger.warn(`Failed to store live location ${key}: ${(error as Error).message}`);
    }
  }

  /**
   * Queue an undelivered event/message in Redis for an offline user.
   */
  async queueOfflineEvent(
    userId: string,
    event: string,
    data: unknown,
    conversationId?: string,
    messageId?: string,
  ): Promise<void> {
    const payload: QueuedOfflineEvent = {
      event,
      conversationId,
      messageId,
      data,
      queuedAt: new Date().toISOString(),
    };

    const key = `offline_queue:${userId}`;
    try {
      await this.redis.rpush(key, JSON.stringify(payload));
      await this.redis.expire(key, OFFLINE_QUEUE_TTL_SECONDS);
    } catch (error) {
      this.logger.warn(`Failed to queue offline event for ${userId}: ${(error as Error).message}`);
    }
  }

  /**
   * Drain and return all queued offline events for a reconnecting user.
   */
  async flushOfflineQueue(userId: string): Promise<QueuedOfflineEvent[]> {
    const key = `offline_queue:${userId}`;
    let rawItems: string[] = [];
    try {
      rawItems = await this.redis.lrangeAndDel(key);
    } catch (error) {
      this.logger.warn(`Failed to flush offline queue for ${userId}: ${(error as Error).message}`);
      return [];
    }

    if (!rawItems || rawItems.length === 0) {
      return [];
    }

    const parsed: QueuedOfflineEvent[] = [];
    for (const raw of rawItems) {
      try {
        parsed.push(JSON.parse(raw) as QueuedOfflineEvent);
      } catch {
        this.logger.warn(`Skipped malformed offline queue item for user ${userId}`);
      }
    }
    return parsed;
  }

  /**
   * Ensure every currently connected socket for the given users joins `conversation:{conversationId}`
   * so newly created chats/groups deliver real-time events immediately without reconnect.
   */
  async ensureSocketsJoinConversation(
    userIds: string[],
    conversationId: string,
  ): Promise<void> {
    if (!this.server || userIds.length === 0) {
      return;
    }

    const userRooms = userIds.map((id) => `user:${id}`);
    if (typeof this.server.in === 'function') {
      await Promise.resolve(
        this.server.in(userRooms).socketsJoin(`conversation:${conversationId}`),
      );
    }
  }

  /**
   * Broadcast an event to all sockets in `conversation:{conversationId}`.
   */
  broadcastToConversation(conversationId: string, event: string, data: unknown): void {
    if (!this.server) {
      this.logger.debug(`Socket server not initialized yet; skipping broadcast ${event}`);
      return;
    }
    this.server.to(`conversation:${conversationId}`).emit(event, data);
  }

  /**
   * Emit an event directly to a specific user's personal room (`user:{userId}`).
   */
  emitToUser(userId: string, event: string, data: unknown): void {
    if (!this.server) {
      return;
    }
    this.server.to(`user:${userId}`).emit(event, data);
  }

  /**
   * Emit an event to a specific call room (`call:{callId}`).
   */
  broadcastToCall(callId: string, event: string, data: unknown, excludeSocketId?: string): void {
    if (!this.server) {
      return;
    }
    if (excludeSocketId) {
      this.server.to(`call:${callId}`).except(excludeSocketId).emit(event, data);
      return;
    }
    this.server.to(`call:${callId}`).emit(event, data);
  }
}

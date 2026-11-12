import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
  forwardRef,
  Logger,
} from '@nestjs/common';
import { Prisma, ReceiptStatus, MessageType } from '@prisma/client';
import * as dns from 'dns/promises';
import * as net from 'net';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { GatewayService } from '../gateway/gateway.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { PollVoteDto } from './dto/chat-actions.dto';

const MESSAGE_INCLUDE = {
  sender: {
    select: {
      id: true,
      displayName: true,
      username: true,
      avatarUrl: true,
    },
  },
  attachments: true,
  reactions: {
    include: {
      user: {
        select: { id: true, displayName: true, avatarUrl: true },
      },
    },
  },
  receipts: true,
  replyTo: {
    select: {
      id: true,
      content: true,
      messageType: true,
      senderId: true,
      isDeletedForEveryone: true,
      sender: {
        select: { id: true, displayName: true },
      },
    },
  },
} satisfies Prisma.MessageInclude;

@Injectable()
export class ChatsService {
  private readonly logger = new Logger(ChatsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(forwardRef(() => GatewayService))
    private readonly gatewayService: GatewayService,
  ) {}

  // ─────────────────────────── Conversations ───────────────────────────────

  async getConversations(
    userId: string,
    cursor?: string,
    limit = 20,
    archived?: boolean,
    search?: string,
  ) {
    const take = Math.min(limit, 100);

    const archivedRecords = await this.prisma.archivedChat.findMany({
      where: { userId },
      select: { conversationId: true },
    });
    const archivedIds = new Set(archivedRecords.map((a) => a.conversationId));

    const where: Prisma.ConversationMemberWhereInput = {
      userId,
      isActive: true,
      leftAt: null,
      ...(archived === true
        ? { conversationId: { in: Array.from(archivedIds) } }
        : archived === false
          ? { conversationId: { notIn: Array.from(archivedIds) } }
          : {}),
      ...(search
        ? {
            conversation: {
              OR: [
                {
                  group: {
                    name: { contains: search, mode: 'insensitive' },
                  },
                },
                {
                  members: {
                    some: {
                      userId: { not: userId },
                      user: {
                        OR: [
                          { displayName: { contains: search, mode: 'insensitive' } },
                          { username: { contains: search, mode: 'insensitive' } },
                          { phoneNumber: { contains: search } },
                        ],
                      },
                    },
                  },
                },
              ],
            },
          }
        : {}),
    };

    const memberships = await this.prisma.conversationMember.findMany({
      where,
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ conversation: { updatedAt: 'desc' } }, { id: 'desc' }],
      include: {
        conversation: {
          include: {
            members: {
              where: { isActive: true },
              include: {
                user: {
                  select: {
                    id: true,
                    displayName: true,
                    username: true,
                    phoneNumber: true,
                    avatarUrl: true,
                    about: true,
                    profile: {
                      select: { isOnline: true, lastSeen: true },
                    },
                  },
                },
              },
            },
            group: true,
            messages: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              include: MESSAGE_INCLUDE,
            },
          },
        },
      },
    });

    const hasNextPage = memberships.length > take;
    const items = hasNextPage ? memberships.slice(0, take) : memberships;
    const nextCursor = hasNextPage ? items[items.length - 1].id : undefined;

    // Best-effort presence heartbeat and delivery confirmation for serverless HTTP polling
    const convIds = items.map((m) => m.conversationId);
    const now = new Date();
    try {
      await Promise.all([
        this.prisma.userProfile.updateMany({
          where: { userId },
          data: { isOnline: true, lastSeen: now },
        }),
        convIds.length > 0
          ? this.prisma.message.updateMany({
              where: {
                conversationId: { in: convIds },
                senderId: { not: userId },
                deliveredAt: null,
              },
              data: { deliveredAt: now },
            })
          : Promise.resolve(),
      ]);
    } catch {
      // Non-fatal in serverless or test mocks
    }

    return {
      items: items.map((m) => ({
        ...m.conversation,
        isArchived: archivedIds.has(m.conversationId),
        membership: {
          id: m.id,
          role: m.role,
          unreadCount: m.unreadCount,
          lastReadMessageId: m.lastReadMessageId,
          joinedAt: m.joinedAt,
        },
        lastMessage: m.conversation.messages[0] ?? null,
      })),
      nextCursor,
      hasNextPage,
    };
  }

  async createDirectConversation(userId: string, otherUserId: string) {
    if (userId === otherUserId) {
      throw new BadRequestException('Cannot create a conversation with yourself');
    }

    const [userA, userB, blocked] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.user.findUnique({ where: { id: otherUserId } }),
      this.prisma.blockedUser.findFirst({
        where: {
          OR: [
            { blockerId: userId, blockedId: otherUserId },
            { blockerId: otherUserId, blockedId: userId },
          ],
        },
      }),
    ]);

    if (!userA || !userB) {
      throw new NotFoundException('User not found');
    }
    if (blocked) {
      throw new ForbiddenException('Cannot start conversation with a blocked user');
    }

    // Reuse existing DIRECT conversation if both users are active members
    const existing = await this.prisma.conversation.findFirst({
      where: {
        type: 'DIRECT',
        AND: [
          { members: { some: { userId, isActive: true } } },
          { members: { some: { userId: otherUserId, isActive: true } } },
        ],
      },
      include: {
        members: {
          where: { isActive: true },
          include: {
            user: {
              select: {
                id: true,
                displayName: true,
                username: true,
                avatarUrl: true,
                profile: { select: { isOnline: true, lastSeen: true } },
              },
            },
          },
        },
      },
    });

    if (existing) {
      try {
        await this.gatewayService.ensureSocketsJoinConversation(
          [userId, otherUserId],
          existing.id,
        );
      } catch (error) {
        this.logger.warn(`Non-fatal socket join error: ${(error as Error).message}`);
      }
      return existing;
    }

    const created = await this.prisma.conversation.create({
      data: {
        type: 'DIRECT',
        createdBy: userId,
        members: {
          create: [
            { userId, role: 'MEMBER' },
            { userId: otherUserId, role: 'MEMBER' },
          ],
        },
      },
      include: {
        members: {
          where: { isActive: true },
          include: {
            user: {
              select: {
                id: true,
                displayName: true,
                username: true,
                avatarUrl: true,
                profile: { select: { isOnline: true, lastSeen: true } },
              },
            },
          },
        },
      },
    });

    try {
      await this.gatewayService.ensureSocketsJoinConversation(
        [userId, otherUserId],
        created.id,
      );
      this.gatewayService.emitToUser(userId, 'conversation_created', created);
      this.gatewayService.emitToUser(otherUserId, 'conversation_created', created);
    } catch (error) {
      this.logger.warn(`Non-fatal socket notify error: ${(error as Error).message}`);
    }

    return created;
  }

  async getConversationDetails(conversationId: string, userId: string) {
    const member = await this.assertMember(conversationId, userId);

    const [conversation, archived] = await Promise.all([
      this.prisma.conversation.findUnique({
        where: { id: conversationId },
        include: {
          members: {
            where: { isActive: true },
            include: {
              user: {
                select: {
                  id: true,
                  displayName: true,
                  username: true,
                  phoneNumber: true,
                  avatarUrl: true,
                  about: true,
                  profile: { select: { isOnline: true, lastSeen: true } },
                },
              },
            },
          },
          group: true,
        },
      }),
      this.prisma.archivedChat.findUnique({
        where: { userId_conversationId: { userId, conversationId } },
      }),
    ]);

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return {
      ...conversation,
      isArchived: Boolean(archived),
      membership: {
        role: member.role,
        unreadCount: member.unreadCount,
        lastReadMessageId: member.lastReadMessageId,
      },
    };
  }

  async archiveConversation(conversationId: string, userId: string) {
    await this.assertMember(conversationId, userId);

    await this.prisma.archivedChat.upsert({
      where: { userId_conversationId: { userId, conversationId } },
      create: { userId, conversationId },
      update: { archivedAt: new Date() },
    });

    return { conversationId, isArchived: true };
  }

  async unarchiveConversation(conversationId: string, userId: string) {
    await this.assertMember(conversationId, userId);

    await this.prisma.archivedChat.deleteMany({
      where: { userId, conversationId },
    });

    return { conversationId, isArchived: false };
  }

  // ─────────────────────────── Messages ────────────────────────────────────

  async getMessages(
    conversationId: string,
    userId: string,
    cursor?: string,
    limit = 20,
  ) {
    await this.assertMember(conversationId, userId);
    const take = Math.min(limit, 100);

    let deletedForMeIds: string[] = [];
    let pinnedIds: string[] = [];
    try {
      [deletedForMeIds, pinnedIds] = await Promise.all([
        this.redis.smembers(`deleted_for_me:${userId}`),
        this.redis.smembers(`pinned:${conversationId}`),
      ]);
    } catch (error) {
      this.logger.warn(
        `Non-fatal Redis read failure in getMessages(${conversationId}): ${(error as Error).message}`,
      );
    }
    const pinnedSet = new Set(pinnedIds);

    const messages = await this.prisma.message.findMany({
      where: {
        conversationId,
        ...(deletedForMeIds.length > 0 ? { id: { notIn: deletedForMeIds } } : {}),
      },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        ...MESSAGE_INCLUDE,
        starredBy: { where: { userId }, select: { id: true } },
      },
    });

    const hasNextPage = messages.length > take;
    const slice = hasNextPage ? messages.slice(0, take) : messages;
    const nextCursor = hasNextPage ? slice[slice.length - 1].id : undefined;

    const undeliveredIds = slice
      .filter((m) => m.senderId !== userId && !m.deliveredAt)
      .map((m) => m.id);
    const deliveryNow = undeliveredIds.length > 0 ? new Date() : null;
    if (deliveryNow && undeliveredIds.length > 0) {
      try {
        await this.prisma.message.updateMany({
          where: { id: { in: undeliveredIds }, deliveredAt: null },
          data: { deliveredAt: deliveryNow },
        });
      } catch {
        // Non-fatal in serverless or test mocks
      }
    }

    const items = slice.map((m) => ({
      ...m,
      deliveredAt:
        m.deliveredAt ?? (deliveryNow && undeliveredIds.includes(m.id) ? deliveryNow : m.deliveredAt),
      isStarred: m.starredBy.length > 0 || m.isStarred,
      isPinned: pinnedSet.has(m.id),
    }));

    return { items, nextCursor, hasNextPage };
  }

  async sendMessage(
    userId: string,
    conversationId: string,
    dto: CreateMessageDto,
  ) {
    await this.assertMember(conversationId, userId);

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        members: { where: { isActive: true }, select: { userId: true } },
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    // For DIRECT chats, block sending if either user blocked the other
    if (conversation.type === 'DIRECT') {
      const otherMember = conversation.members.find((m) => m.userId !== userId);
      if (otherMember) {
        const blocked = await this.prisma.blockedUser.findFirst({
          where: {
            OR: [
              { blockerId: userId, blockedId: otherMember.userId },
              { blockerId: otherMember.userId, blockedId: userId },
            ],
          },
        });
        if (blocked) {
          throw new ForbiddenException('Cannot send messages in a blocked conversation');
        }
      }
    }

    // Build serialized content for structured message types if content omitted
    let content = dto.content ?? null;
    if (!content && (dto.latitude !== undefined || dto.contactPhone !== undefined)) {
      content = JSON.stringify({
        latitude: dto.latitude,
        longitude: dto.longitude,
        contactName: dto.contactName,
        contactPhone: dto.contactPhone,
      });
    }

    const now = new Date();

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          conversationId,
          senderId: userId,
          content,
          messageType: dto.messageType,
          replyToId: dto.replyToId,
          isViewOnce: dto.isViewOnce ?? false,
          isEncrypted: dto.isEncrypted ?? false,
          encryptionMetadata: dto.encryptionMetadata
            ? (dto.encryptionMetadata as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          sentAt: now,
          ...(dto.attachmentUrl
            ? {
                attachments: {
                  create: {
                    fileType: dto.messageType,
                    fileUrl: dto.attachmentUrl,
                    fileName: dto.attachmentName,
                    fileSize: dto.attachmentSize ?? null,
                    mimeType: dto.mimeType,
                    duration: dto.duration,
                    width: dto.width,
                    height: dto.height,
                    thumbnailUrl: dto.thumbnailUrl,
                  },
                },
              }
            : {}),
        },
        include: MESSAGE_INCLUDE,
      });

      // Touch conversation updatedAt for chat list ordering
      await tx.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: now },
      });

      // Increment unread counts for other active members
      await tx.conversationMember.updateMany({
        where: {
          conversationId,
          userId: { not: userId },
          isActive: true,
        },
        data: { unreadCount: { increment: 1 } },
      });

      // Reset sender's unread count & lastReadMessageId
      await tx.conversationMember.updateMany({
        where: { conversationId, userId },
        data: { unreadCount: 0, lastReadMessageId: created.id },
      });

      // Create initial SENT receipts for recipients
      const recipientIds = conversation.members
        .map((m) => m.userId)
        .filter((id) => id !== userId);

      if (recipientIds.length > 0) {
        await tx.messageReceipt.createMany({
          data: recipientIds.map((recipientId) => ({
            messageId: created.id,
            userId: recipientId,
            status: ReceiptStatus.SENT,
            timestamp: now,
          })),
          skipDuplicates: true,
        });
      }

      return created;
    }, { maxWait: 10000, timeout: 15000 });

    // Clear typing state, join rooms, broadcast & queue offline recipients (non-fatal if Redis/socket unavailable)
    try {
      await this.gatewayService.setTyping(conversationId, userId, false);
    } catch (error) {
      this.logger.warn(`Non-fatal setTyping failure: ${(error as Error).message}`);
    }

    try {
      const memberIds = conversation.members.map((m) => m.userId);
      await this.gatewayService.ensureSocketsJoinConversation(memberIds, conversationId);
      this.gatewayService.broadcastToConversation(conversationId, 'new_message', message);
    } catch (error) {
      this.logger.warn(`Non-fatal gateway broadcast failure: ${(error as Error).message}`);
    }

    try {
      await this.queueOfflineRecipients(
        conversation.members.map((m) => m.userId).filter((id) => id !== userId),
        conversationId,
        message,
      );
    } catch (error) {
      this.logger.warn(`Non-fatal offline queue failure: ${(error as Error).message}`);
    }

    return message;
  }

  private async queueOfflineRecipients(
    recipientIds: string[],
    conversationId: string,
    message: { id: string },
  ): Promise<void> {
    await Promise.all(
      recipientIds.map(async (recipientId) => {
        try {
          const online = await this.gatewayService.isUserOnline(recipientId);
          if (!online) {
            await this.gatewayService.queueOfflineEvent(
              recipientId,
              'new_message',
              message,
              conversationId,
              message.id,
            );
          }
        } catch (error) {
          this.logger.warn(
            `Non-fatal offline queue error for ${recipientId}: ${(error as Error).message}`,
          );
        }
      }),
    );
  }

  async editMessage(userId: string, messageId: string, newContent: string) {
    const msg = await this.findMessageOrFail(messageId);
    if (msg.senderId !== userId) {
      throw new ForbiddenException('Only the sender can edit this message');
    }
    if (msg.isDeletedForEveryone) {
      throw new BadRequestException('Cannot edit a deleted message');
    }

    const now = new Date();
    const [updated] = await this.prisma.$transaction([
      this.prisma.message.update({
        where: { id: messageId },
        data: { content: newContent, isEdited: true, updatedAt: now },
        include: MESSAGE_INCLUDE,
      }),
      this.prisma.messageEdit.create({
        data: {
          messageId,
          oldContent: msg.content ?? '',
          newContent,
          editedAt: now,
        },
      }),
    ]);

    this.gatewayService.broadcastToConversation(
      msg.conversationId,
      'message_updated',
      updated,
    );

    return updated;
  }

  async deleteMessage(
    userId: string,
    messageId: string,
    deleteForEveryone: boolean,
  ) {
    const msg = await this.findMessageOrFail(messageId);
    await this.assertMember(msg.conversationId, userId);

    if (deleteForEveryone) {
      if (msg.senderId !== userId) {
        throw new ForbiddenException('Only the sender can delete for everyone');
      }

      const updated = await this.prisma.message.update({
        where: { id: messageId },
        data: {
          isDeletedForEveryone: true,
          content: null,
          updatedAt: new Date(),
        },
      });

      this.gatewayService.broadcastToConversation(msg.conversationId, 'message_deleted', {
        messageId,
        conversationId: msg.conversationId,
        deleteForEveryone: true,
        deletedBy: userId,
      });

      return updated;
    }

    // Delete for current user only (stored per-user in Redis)
    try {
      await this.redis.sadd(`deleted_for_me:${userId}`, messageId);
    } catch (error) {
      this.logger.warn(
        `Non-fatal Redis sadd failure in deleteMessage(${messageId}): ${(error as Error).message}`,
      );
    }
    return {
      messageId,
      conversationId: msg.conversationId,
      deleteForEveryone: false,
      deleted: true,
    };
  }

  async addReaction(userId: string, messageId: string, emoji: string) {
    const msg = await this.findMessageOrFail(messageId);
    await this.assertMember(msg.conversationId, userId);

    const existing = await this.prisma.messageReaction.findUnique({
      where: { messageId_userId_emoji: { messageId, userId, emoji } },
    });

    if (existing) {
      await this.prisma.messageReaction.delete({ where: { id: existing.id } });
      const payload = {
        action: 'removed',
        messageId,
        conversationId: msg.conversationId,
        userId,
        emoji,
      };
      this.gatewayService.broadcastToConversation(
        msg.conversationId,
        'message_reaction',
        payload,
      );
      return payload;
    }

    const reaction = await this.prisma.messageReaction.create({
      data: { messageId, userId, emoji },
      include: {
        user: { select: { id: true, displayName: true, avatarUrl: true } },
      },
    });

    const payload = {
      action: 'added',
      messageId,
      conversationId: msg.conversationId,
      userId,
      emoji,
      reaction,
    };
    this.gatewayService.broadcastToConversation(
      msg.conversationId,
      'message_reaction',
      payload,
    );
    return payload;
  }

  async removeReaction(userId: string, messageId: string, emoji: string) {
    const msg = await this.findMessageOrFail(messageId);
    await this.assertMember(msg.conversationId, userId);

    const existing = await this.prisma.messageReaction.findUnique({
      where: { messageId_userId_emoji: { messageId, userId, emoji } },
    });

    if (!existing) {
      throw new NotFoundException('Reaction not found');
    }

    await this.prisma.messageReaction.delete({ where: { id: existing.id } });

    const payload = {
      action: 'removed',
      messageId,
      conversationId: msg.conversationId,
      userId,
      emoji,
    };
    this.gatewayService.broadcastToConversation(
      msg.conversationId,
      'message_reaction',
      payload,
    );
    return payload;
  }

  async starMessage(userId: string, messageId: string) {
    const msg = await this.findMessageOrFail(messageId);
    await this.assertMember(msg.conversationId, userId);

    const starred = await this.prisma.starredMessage.upsert({
      where: { userId_messageId: { userId, messageId } },
      create: { userId, messageId },
      update: {},
    });

    await this.prisma.message.update({
      where: { id: messageId },
      data: { isStarred: true },
    });

    return starred;
  }

  async unstarMessage(userId: string, messageId: string) {
    const existing = await this.prisma.starredMessage.findUnique({
      where: { userId_messageId: { userId, messageId } },
    });
    if (!existing) {
      throw new NotFoundException('Starred message not found');
    }

    await this.prisma.starredMessage.delete({ where: { id: existing.id } });

    const remainingStars = await this.prisma.starredMessage.count({
      where: { messageId },
    });
    if (remainingStars === 0) {
      await this.prisma.message.update({
        where: { id: messageId },
        data: { isStarred: false },
      });
    }

    return { messageId, unstarred: true };
  }

  async getStarredMessages(userId: string, cursor?: string, limit = 20) {
    const take = Math.min(limit, 100);

    const starred = await this.prisma.starredMessage.findMany({
      where: { userId },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ starredAt: 'desc' }, { id: 'desc' }],
      include: {
        message: {
          include: {
            ...MESSAGE_INCLUDE,
            conversation: {
              select: { id: true, type: true, group: { select: { name: true } } },
            },
          },
        },
      },
    });

    const hasNextPage = starred.length > take;
    const items = hasNextPage ? starred.slice(0, take) : starred;
    const nextCursor = hasNextPage ? items[items.length - 1].id : undefined;

    return { items, nextCursor, hasNextPage };
  }

  async forwardMessage(
    userId: string,
    messageId: string,
    toConversationId: string,
  ) {
    const msg = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { attachments: true },
    });
    if (!msg) {
      throw new NotFoundException('Message not found');
    }

    await Promise.all([
      this.assertMember(msg.conversationId, userId),
      this.assertMember(toConversationId, userId),
    ]);

    const now = new Date();
    const forwarded = await this.prisma.message.create({
      data: {
        conversationId: toConversationId,
        senderId: userId,
        content: msg.content,
        messageType: msg.messageType,
        forwardedFromId: msg.id,
        sentAt: now,
        ...(msg.attachments.length > 0
          ? {
              attachments: {
                create: msg.attachments.map((att) => ({
                  fileType: att.fileType,
                  fileUrl: att.fileUrl,
                  fileName: att.fileName,
                  fileSize: att.fileSize,
                  mimeType: att.mimeType,
                  duration: att.duration,
                  width: att.width,
                  height: att.height,
                  thumbnailUrl: att.thumbnailUrl,
                })),
              },
            }
          : {}),
      },
      include: MESSAGE_INCLUDE,
    });

    await this.prisma.conversation.update({
      where: { id: toConversationId },
      data: { updatedAt: now },
    });

    await this.prisma.conversationMember.updateMany({
      where: { conversationId: toConversationId, userId: { not: userId }, isActive: true },
      data: { unreadCount: { increment: 1 } },
    });

    const targetMembers =
      (await this.prisma.conversationMember.findMany({
        where: { conversationId: toConversationId, isActive: true },
        select: { userId: true },
      })) ?? [];
    const targetMemberIds = targetMembers.map((m) => m.userId);
    if (targetMemberIds.length > 0) {
      try {
        await this.gatewayService.ensureSocketsJoinConversation(
          targetMemberIds,
          toConversationId,
        );
      } catch (error) {
        this.logger.warn(`Non-fatal socket join in forwardMessage: ${(error as Error).message}`);
      }
      try {
        await this.queueOfflineRecipients(
          targetMemberIds.filter((id) => id !== userId),
          toConversationId,
          forwarded,
        );
      } catch (error) {
        this.logger.warn(`Non-fatal offline queue in forwardMessage: ${(error as Error).message}`);
      }
    }

    try {
      this.gatewayService.broadcastToConversation(
        toConversationId,
        'new_message',
        forwarded,
      );
    } catch (error) {
      this.logger.warn(`Non-fatal broadcast in forwardMessage: ${(error as Error).message}`);
    }

    return forwarded;
  }

  async markAsDelivered(userId: string, messageId: string) {
    const msg = await this.findMessageOrFail(messageId);
    await this.assertMember(msg.conversationId, userId);

    const now = new Date();
    const receipt = await this.prisma.messageReceipt.upsert({
      where: { messageId_userId: { messageId, userId } },
      create: {
        messageId,
        userId,
        status: ReceiptStatus.DELIVERED,
        timestamp: now,
      },
      update: {
        status: ReceiptStatus.DELIVERED,
        timestamp: now,
      },
    });

    if (!msg.deliveredAt) {
      await this.prisma.message.update({
        where: { id: messageId },
        data: { deliveredAt: now },
      });
    }

    return {
      conversationId: msg.conversationId,
      messageId,
      userId,
      status: ReceiptStatus.DELIVERED,
      timestamp: receipt.timestamp,
    };
  }

  async markAsRead(userId: string, conversationId: string, messageId: string) {
    await this.assertMember(conversationId, userId);
    const msg = await this.findMessageOrFail(messageId);

    if (msg.conversationId !== conversationId) {
      throw new BadRequestException('Message does not belong to conversation');
    }

    const now = new Date();

    const receipt = await this.prisma.messageReceipt.upsert({
      where: { messageId_userId: { messageId, userId } },
      create: {
        messageId,
        userId,
        status: ReceiptStatus.READ,
        timestamp: now,
      },
      update: {
        status: ReceiptStatus.READ,
        timestamp: now,
      },
    });

    if (!msg.readAt) {
      await this.prisma.message.update({
        where: { id: messageId },
        data: { readAt: now, deliveredAt: msg.deliveredAt ?? now },
      });
    }

    // Mark all earlier unread messages from other participants in this conversation as read too
    try {
      await Promise.all([
        this.prisma.message.updateMany({
          where: {
            conversationId,
            senderId: { not: userId },
            createdAt: { lte: msg.createdAt },
            readAt: null,
          },
          data: { readAt: now },
        }),
        this.prisma.message.updateMany({
          where: {
            conversationId,
            senderId: { not: userId },
            createdAt: { lte: msg.createdAt },
            deliveredAt: null,
          },
          data: { deliveredAt: now },
        }),
      ]);
    } catch {
      // Non-fatal in serverless or test mocks
    }

    await this.prisma.conversationMember.updateMany({
      where: { conversationId, userId },
      data: { unreadCount: 0, lastReadMessageId: messageId },
    });

    const payload = {
      conversationId,
      messageId,
      userId,
      status: ReceiptStatus.READ,
      timestamp: receipt.timestamp,
    };

    try {
      this.gatewayService.broadcastToConversation(
        conversationId,
        'message_receipt',
        payload,
      );
    } catch {
      // Non-fatal in serverless or when socket gateway is unavailable
    }

    return payload;
  }

  async updateUnreadCount(conversationId: string, userId: string) {
    const membership = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      include: { lastReadMessage: { select: { createdAt: true } } },
    });

    if (!membership) return 0;

    const since = membership.lastReadMessage?.createdAt ?? new Date(0);
    const unreadCount = await this.prisma.message.count({
      where: {
        conversationId,
        senderId: { not: userId },
        createdAt: { gt: since },
      },
    });

    await this.prisma.conversationMember.update({
      where: { id: membership.id },
      data: { unreadCount },
    });

    return unreadCount;
  }

  // ─────────────────────────── Pin / Unpin Messages ────────────────────────

  async pinMessage(userId: string, messageId: string) {
    const msg = await this.findMessageOrFail(messageId);
    await this.assertMember(msg.conversationId, userId);

    const pinnedAt = new Date().toISOString();
    try {
      await this.redis.sadd(`pinned:${msg.conversationId}`, messageId);
      await this.redis.hset(
        `pinned_meta:${msg.conversationId}`,
        messageId,
        JSON.stringify({ messageId, pinnedBy: userId, pinnedAt }),
      );
    } catch (error) {
      this.logger.warn(`Non-fatal Redis pin failure: ${(error as Error).message}`);
    }

    const payload = {
      conversationId: msg.conversationId,
      messageId,
      pinnedBy: userId,
      pinnedAt,
      pinned: true,
    };

    try {
      this.gatewayService.broadcastToConversation(
        msg.conversationId,
        'message_pinned',
        payload,
      );
    } catch (error) {
      this.logger.warn(`Non-fatal broadcast pin failure: ${(error as Error).message}`);
    }

    return payload;
  }

  async unpinMessage(userId: string, messageId: string) {
    const msg = await this.findMessageOrFail(messageId);
    await this.assertMember(msg.conversationId, userId);

    try {
      await this.redis.srem(`pinned:${msg.conversationId}`, messageId);
      await this.redis.hdel(`pinned_meta:${msg.conversationId}`, messageId);
    } catch (error) {
      this.logger.warn(`Non-fatal Redis unpin failure: ${(error as Error).message}`);
    }

    const payload = {
      conversationId: msg.conversationId,
      messageId,
      unpinnedBy: userId,
      pinned: false,
    };

    try {
      this.gatewayService.broadcastToConversation(
        msg.conversationId,
        'message_unpinned',
        payload,
      );
    } catch (error) {
      this.logger.warn(`Non-fatal broadcast unpin failure: ${(error as Error).message}`);
    }

    return payload;
  }

  async getPinnedMessages(conversationId: string, userId: string) {
    await this.assertMember(conversationId, userId);

    let pinnedIds: string[] = [];
    let metaMap: Record<string, string> = {};
    try {
      pinnedIds = await this.redis.smembers(`pinned:${conversationId}`);
      if (pinnedIds.length === 0) {
        return [];
      }
      const client = this.redis.getClient();
      metaMap = await client.hgetall(`pinned_meta:${conversationId}`);
    } catch (error) {
      this.logger.warn(`Non-fatal Redis getPinnedMessages failure: ${(error as Error).message}`);
      return [];
    }

    if (pinnedIds.length === 0) {
      return [];
    }

    const messages = await this.prisma.message.findMany({
      where: {
        id: { in: pinnedIds },
        conversationId,
        isDeletedForEveryone: false,
      },
      include: MESSAGE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    return messages.map((m) => {
      let pinnedMeta: { pinnedBy?: string; pinnedAt?: string } = {};
      const raw = metaMap[m.id];
      if (raw) {
        try {
          pinnedMeta = JSON.parse(raw) as { pinnedBy?: string; pinnedAt?: string };
        } catch {
          pinnedMeta = {};
        }
      }
      return {
        ...m,
        isPinned: true,
        pinnedBy: pinnedMeta.pinnedBy ?? null,
        pinnedAt: pinnedMeta.pinnedAt ?? null,
      };
    });
  }

  // ─────────────────────────── Poll Voting ─────────────────────────────────

  async votePoll(userId: string, messageId: string, dto: PollVoteDto) {
    if (dto.optionIndex === undefined && !dto.optionId) {
      throw new BadRequestException('Either optionIndex or optionId is required');
    }

    const msg = await this.findMessageOrFail(messageId);
    await this.assertMember(msg.conversationId, userId);

    if (msg.messageType !== MessageType.POLL) {
      throw new BadRequestException('Message is not a poll');
    }

    let pollData: {
      question?: string;
      allowMultiple?: boolean;
      options?: Array<{
        id?: string;
        text: string;
        votes?: string[] | number;
      }>;
    };

    try {
      pollData = JSON.parse(msg.content ?? '{}');
    } catch {
      throw new BadRequestException('Invalid poll payload');
    }

    if (!Array.isArray(pollData.options) || pollData.options.length === 0) {
      throw new BadRequestException('Poll has no options');
    }

    const targetIndex =
      dto.optionId !== undefined
        ? pollData.options.findIndex((o) => o.id === dto.optionId)
        : (dto.optionIndex ?? -1);

    if (targetIndex < 0 || targetIndex >= pollData.options.length) {
      throw new BadRequestException('Invalid poll option');
    }

    // Atomically track voter per option in Redis (non-fatal fallback to DB JSON if Redis unavailable)
    const voterKeyPrefix = `poll_voters:${messageId}`;
    try {
      const client = this.redis.getClient();
      const alreadyVotedSet = await client.sismember(
        `${voterKeyPrefix}:${targetIndex}`,
        userId,
      );

      if (!pollData.allowMultiple) {
        await Promise.all(
          pollData.options.map(async (opt, idx) => {
            if (idx !== targetIndex) {
              await client.srem(`${voterKeyPrefix}:${idx}`, userId);
              if (Array.isArray(opt.votes)) {
                opt.votes = opt.votes.filter((id) => id !== userId);
              }
            }
          }),
        );
      }

      if (alreadyVotedSet === 1) {
        await client.srem(`${voterKeyPrefix}:${targetIndex}`, userId);
      } else {
        await client.sadd(`${voterKeyPrefix}:${targetIndex}`, userId);
      }

      await Promise.all(
        pollData.options.map(async (opt, idx) => {
          const voters = await client.smembers(`${voterKeyPrefix}:${idx}`);
          if (typeof opt.votes === 'number') {
            opt.votes = voters.length;
          } else {
            const merged = new Set(Array.isArray(opt.votes) ? opt.votes : []);
            if (idx === targetIndex) {
              if (alreadyVotedSet === 1) {
                merged.delete(userId);
              } else {
                merged.add(userId);
              }
            } else if (!pollData.allowMultiple) {
              merged.delete(userId);
            }
            for (const v of voters) {
              merged.add(v);
            }
            opt.votes = Array.from(merged);
          }
          await this.redis.hset(
            `poll_votes:${messageId}`,
            String(idx),
            String(Array.isArray(opt.votes) ? opt.votes.length : opt.votes ?? 0),
          );
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Non-fatal Redis poll sync failure for ${messageId}; updating JSON directly: ${(error as Error).message}`,
      );
      const targetOpt = pollData.options[targetIndex];
      const existingVotes = Array.isArray(targetOpt.votes) ? targetOpt.votes : [];
      const alreadyVoted = existingVotes.includes(userId);
      if (!pollData.allowMultiple) {
        pollData.options.forEach((opt, idx) => {
          if (idx !== targetIndex && Array.isArray(opt.votes)) {
            opt.votes = opt.votes.filter((id) => id !== userId);
          }
        });
      }
      if (typeof targetOpt.votes === 'number') {
        targetOpt.votes = Math.max(0, targetOpt.votes + 1);
      } else {
        const set = new Set(existingVotes);
        if (alreadyVoted) set.delete(userId);
        else set.add(userId);
        targetOpt.votes = Array.from(set);
      }
    }

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: {
        content: JSON.stringify(pollData),
        updatedAt: new Date(),
      },
      include: MESSAGE_INCLUDE,
    });

    try {
      this.gatewayService.broadcastToConversation(
        msg.conversationId,
        'message_updated',
        updated,
      );
    } catch (error) {
      this.logger.warn(`Non-fatal poll broadcast failure: ${(error as Error).message}`);
    }

    return updated;
  }

  // ─────────────────────────── Message Info ────────────────────────────────

  async getMessageInfo(userId: string, messageId: string) {
    const msg = await this.findMessageOrFail(messageId);
    await this.assertMember(msg.conversationId, userId);

    const [receipts, members] = await Promise.all([
      this.prisma.messageReceipt.findMany({
        where: { messageId },
        include: {
          user: {
            select: {
              id: true,
              displayName: true,
              username: true,
              avatarUrl: true,
            },
          },
        },
        orderBy: { timestamp: 'asc' },
      }),
      this.prisma.conversationMember.findMany({
        where: {
          conversationId: msg.conversationId,
          isActive: true,
          userId: { not: msg.senderId },
        },
        include: {
          user: {
            select: {
              id: true,
              displayName: true,
              username: true,
              avatarUrl: true,
            },
          },
        },
      }),
    ]);

    const readBy = receipts.filter((r) => r.status === ReceiptStatus.READ);
    const deliveredTo = receipts.filter(
      (r) => r.status === ReceiptStatus.DELIVERED || r.status === ReceiptStatus.READ,
    );
    const sentTo = receipts.filter((r) => r.status === ReceiptStatus.SENT);

    const receiptMap = new Map(receipts.map((r) => [r.userId, r]));
    const pending = members
      .filter((m) => !receiptMap.has(m.userId))
      .map((m) => ({ user: m.user, status: 'PENDING' }));

    return {
      messageId: msg.id,
      conversationId: msg.conversationId,
      senderId: msg.senderId,
      sentAt: msg.sentAt,
      deliveredAt: msg.deliveredAt,
      readAt: msg.readAt,
      readBy,
      deliveredTo,
      sentTo,
      pending,
      receipts,
    };
  }

  // ─────────────────────────── Link Preview (SSRF-safe) ────────────────────

  async getLinkPreview(rawUrl: string) {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new BadRequestException('Invalid URL');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException('Only http and https URLs are supported');
    }

    await this.assertSafePublicHost(parsed.hostname);

    const cacheKey = `link_preview:${parsed.toString()}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as Record<string, unknown>;
      }
    } catch {
      // Ignore cache read/parse errors
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    try {
      const response = await fetch(parsed.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'WhatsAppProBot/1.0 (+https://whatsapp-pro.local)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });

      if (response.status >= 300 && response.status < 400) {
        return {
          url: parsed.toString(),
          title: parsed.hostname,
          description: null,
          image: null,
          siteName: parsed.hostname,
        };
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
        return {
          url: parsed.toString(),
          title: parsed.hostname,
          description: null,
          image: null,
          siteName: parsed.hostname,
        };
      }

      const text = (await response.text()).slice(0, 512 * 1024);

      const title =
        this.extractMetaTag(text, 'og:title') ??
        this.extractMetaTag(text, 'twitter:title') ??
        this.extractHtmlTitle(text) ??
        parsed.hostname;

      const description =
        this.extractMetaTag(text, 'og:description') ??
        this.extractMetaTag(text, 'twitter:description') ??
        this.extractMetaTag(text, 'description') ??
        null;

      const image =
        this.extractMetaTag(text, 'og:image') ??
        this.extractMetaTag(text, 'twitter:image') ??
        null;

      const siteName =
        this.extractMetaTag(text, 'og:site_name') ?? parsed.hostname;

      const preview = {
        url: parsed.toString(),
        title,
        description,
        image,
        siteName,
      };

      try {
        await this.redis.set(cacheKey, JSON.stringify(preview), 3600);
      } catch {
        // Non-fatal cache write error
      }
      return preview;
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new BadRequestException('Link preview request timed out');
      }
      return {
        url: parsed.toString(),
        title: parsed.hostname,
        description: null,
        image: null,
        siteName: parsed.hostname,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async assertSafePublicHost(hostname: string): Promise<void> {
    const lower = hostname.toLowerCase();
    if (
      lower === 'localhost' ||
      lower.endsWith('.localhost') ||
      lower.endsWith('.local') ||
      lower.endsWith('.internal')
    ) {
      throw new ForbiddenException('Private or local hosts are not allowed');
    }

    if (net.isIP(lower)) {
      if (this.isPrivateIp(lower)) {
        throw new ForbiddenException('Private IP addresses are not allowed');
      }
      return;
    }

    let records: Array<{ address: string }>;
    try {
      records = await dns.lookup(lower, { all: true });
    } catch {
      throw new BadRequestException('Unable to resolve hostname');
    }

    if (!records || records.length === 0) {
      throw new BadRequestException('Unable to resolve hostname');
    }

    for (const rec of records) {
      if (this.isPrivateIp(rec.address)) {
        throw new ForbiddenException('Target host resolves to a private IP address');
      }
    }
  }

  private isPrivateIp(ip: string): boolean {
    const normalized = ip.toLowerCase();
    if (normalized.startsWith('::ffff:')) {
      return this.isPrivateIp(normalized.slice(7));
    }

    if (net.isIPv4(normalized)) {
      const parts = normalized.split('.').map(Number);
      const [a, b] = parts;
      if (a === 10) return true; // 10.0.0.0/8
      if (a === 127) return true; // 127.0.0.0/8
      if (a === 0) return true; // 0.0.0.0/8
      if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / cloud metadata
      if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
      if (a === 192 && b === 168) return true; // 192.168.0.0/16
      if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
      if (a >= 224) return true; // multicast/reserved
      return false;
    }

    if (net.isIPv6(normalized)) {
      if (
        normalized === '::1' ||
        normalized === '::' ||
        normalized.startsWith('fc') ||
        normalized.startsWith('fd') ||
        normalized.startsWith('fe80')
      ) {
        return true;
      }
      return false;
    }

    return true;
  }

  private extractMetaTag(html: string, key: string): string | null {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(
        `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
        'i',
      ),
      new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`,
        'i',
      ),
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) {
        return this.decodeHtmlEntities(match[1].trim());
      }
    }
    return null;
  }

  private extractHtmlTitle(html: string): string | null {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return match?.[1] ? this.decodeHtmlEntities(match[1].trim()) : null;
  }

  private decodeHtmlEntities(input: string): string {
    return input
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  // ─────────────────────────── Membership Helpers ──────────────────────────

  async isConversationMember(conversationId: string, userId: string): Promise<boolean> {
    const member = await this.prisma.conversationMember.findFirst({
      where: { conversationId, userId, isActive: true, leftAt: null },
      select: { id: true },
    });
    return Boolean(member);
  }

  async getUserConversationIds(userId: string): Promise<string[]> {
    const memberships = await this.prisma.conversationMember.findMany({
      where: { userId, isActive: true, leftAt: null },
      select: { conversationId: true },
    });
    return memberships.map((m) => m.conversationId);
  }

  private async assertMember(conversationId: string, userId: string) {
    const member = await this.prisma.conversationMember.findFirst({
      where: { conversationId, userId, isActive: true, leftAt: null },
    });
    if (!member) {
      throw new ForbiddenException('Not an active member of this conversation');
    }
    return member;
  }

  private async findMessageOrFail(messageId: string) {
    const msg = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!msg) {
      throw new NotFoundException('Message not found');
    }
    return msg;
  }
}

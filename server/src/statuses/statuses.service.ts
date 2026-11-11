import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ConversationType,
  MemberRole,
  MessageType,
  StatusContentType,
  StatusPrivacy,
  StatusVisibilityScope,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CreateStatusDto } from './dto/create-status.dto';

const STATUS_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const STATUS_SELECTED_KEY_PREFIX = 'status:selected:';
const STATUS_EXPIRY_ZSET = 'statuses:expiry_schedule';

export interface VisibleStatusItem {
  id: string;
  userId: string;
  contentType: StatusContentType;
  contentUrl: string | null;
  textContent: string | null;
  caption: string | null;
  backgroundColor: string | null;
  fontStyle: string | null;
  privacy: StatusPrivacy;
  expiresAt: Date;
  createdAt: Date;
  user: {
    id: string;
    displayName: string;
    username: string | null;
    avatarUrl: string | null;
  };
  isViewed: boolean;
  myReaction: { id: string; emoji: string; createdAt: Date } | null;
}

export interface StatusGroupItem {
  user: VisibleStatusItem['user'];
  statuses: VisibleStatusItem[];
  hasUnviewed: boolean;
}

@Injectable()
export class StatusesService {
  private readonly logger = new Logger(StatusesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async createStatus(userId: string, dto: CreateStatusDto) {
    const contentType = dto.contentType ?? dto.type ?? StatusContentType.TEXT;
    const textContent =
      contentType === StatusContentType.TEXT ? (dto.textContent ?? dto.content ?? null) : null;
    const contentUrl =
      contentType !== StatusContentType.TEXT ? (dto.contentUrl ?? dto.content ?? null) : null;

    if (contentType === StatusContentType.TEXT && !textContent?.trim()) {
      throw new BadRequestException('textContent or content is required for TEXT status');
    }
    if (contentType !== StatusContentType.TEXT && !contentUrl?.trim()) {
      throw new BadRequestException('contentUrl or content is required for media status');
    }

    // Fall back to user's privacy_settings.status_visibility if privacy is not explicitly provided
    let privacy = dto.privacy;
    if (!privacy) {
      const privacySetting = await this.prisma.privacySetting.findUnique({
        where: { userId },
      });
      if (privacySetting) {
        privacy = this.mapVisibilityToStatusPrivacy(privacySetting.statusVisibility);
      } else {
        privacy = StatusPrivacy.CONTACTS;
      }
    }

    const expiresAt = new Date(Date.now() + STATUS_TTL_SECONDS * 1000);

    const status = await this.prisma.status.create({
      data: {
        userId,
        contentType,
        contentUrl,
        textContent,
        caption: dto.caption ?? null,
        backgroundColor: dto.backgroundColor ?? null,
        fontStyle: dto.fontStyle ?? null,
        privacy,
        expiresAt,
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
    });

    // Store selected audience if privacy === SELECTED
    if (privacy === StatusPrivacy.SELECTED && dto.selectedUserIds?.length) {
      await this.redis.set(
        `${STATUS_SELECTED_KEY_PREFIX}${status.id}`,
        JSON.stringify(dto.selectedUserIds),
        STATUS_TTL_SECONDS,
      );
    }

    // Track expiration in Redis sorted set for quick inspection/cleanup
    try {
      await this.redis
        .getClient()
        .zadd(STATUS_EXPIRY_ZSET, expiresAt.getTime(), status.id);
    } catch (err) {
      this.logger.warn(`Failed to schedule status in Redis zset: ${(err as Error).message}`);
    }

    return status;
  }

  async getContactsStatuses(userId: string): Promise<StatusGroupItem[]> {
    const now = new Date();

    // Load user's saved contacts, active DIRECT conversation peers, and blocked relationships
    const [contacts, directPeers, blockedRelations] = await Promise.all([
      this.prisma.contact.findMany({
        where: { ownerId: userId },
        select: { contactId: true },
      }),
      this.prisma.conversationMember.findMany({
        where: {
          userId: { not: userId },
          isActive: true,
          leftAt: null,
          conversation: {
            type: ConversationType.DIRECT,
            members: {
              some: {
                userId,
                isActive: true,
                leftAt: null,
              },
            },
          },
        },
        select: { userId: true },
      }),
      this.prisma.blockedUser.findMany({
        where: {
          OR: [{ blockerId: userId }, { blockedId: userId }],
        },
        select: { blockerId: true, blockedId: true },
      }),
    ]);

    const blockedIds = new Set<string>();
    for (const rel of blockedRelations) {
      blockedIds.add(rel.blockerId === userId ? rel.blockedId : rel.blockerId);
    }

    const directPeerIds = new Set<string>(
      directPeers.map((p) => p.userId).filter((id) => id !== userId && !blockedIds.has(id)),
    );

    const candidateOwnerIds = Array.from(
      new Set<string>([
        ...contacts.map((c) => c.contactId),
        ...directPeerIds,
      ]),
    ).filter((id) => id !== userId && !blockedIds.has(id));

    if (candidateOwnerIds.length === 0) {
      return [];
    }

    // Fetch active statuses from contacts and direct-chat peers
    const statuses = await this.prisma.status.findMany({
      where: {
        userId: { in: candidateOwnerIds },
        expiresAt: { gt: now },
        privacy: { not: StatusPrivacy.NONE },
      },
      orderBy: { createdAt: 'asc' },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            username: true,
            avatarUrl: true,
            isActive: true,
            isBanned: true,
            privacySettings: {
              select: { statusVisibility: true },
            },
            ownedContacts: {
              where: { contactId: userId },
              select: { id: true },
            },
          },
        },
        views: {
          where: { viewerId: userId },
          select: { id: true, viewedAt: true },
        },
        reactions: {
          where: { userId },
          select: { id: true, emoji: true, createdAt: true },
        },
      },
    });

    // Filter statuses respecting both the status's privacy and the owner's privacy_settings.statusVisibility
    const visibleStatuses: VisibleStatusItem[] = [];
    for (const s of statuses) {
      if (!s.user.isActive || s.user.isBanned) {
        continue;
      }

      const ownerPrivacy = s.user.privacySettings?.statusVisibility;
      if (s.privacy === StatusPrivacy.NONE || ownerPrivacy === StatusVisibilityScope.NOBODY) {
        continue;
      }

      if (
        s.privacy === StatusPrivacy.SELECTED ||
        ownerPrivacy === StatusVisibilityScope.SELECTED
      ) {
        const selectedRaw = await this.redis.get(`${STATUS_SELECTED_KEY_PREFIX}${s.id}`);
        if (!selectedRaw) {
          continue;
        }
        const selectedIds: string[] = JSON.parse(selectedRaw);
        if (!selectedIds.includes(userId)) {
          continue;
        }
      } else if (s.privacy === StatusPrivacy.ALL) {
        // Explicit ALL status (and owner didn't set NOBODY/SELECTED): visible to contacts and direct chat peers
      } else {
        // CONTACTS-scoped status: visible if owner saved viewer as contact or they have an active DIRECT chat
        const viewerIsInOwnersContacts = s.user.ownedContacts.length > 0;
        const isDirectChatPeer = directPeerIds.has(s.userId);
        if (!viewerIsInOwnersContacts && !isDirectChatPeer) {
          continue;
        }
      }

      const { privacySettings, ownedContacts, isActive, isBanned, ...safeUser } = s.user;
      visibleStatuses.push({
        id: s.id,
        userId: s.userId,
        contentType: s.contentType,
        contentUrl: s.contentUrl,
        textContent: s.textContent,
        caption: s.caption,
        backgroundColor: s.backgroundColor,
        fontStyle: s.fontStyle,
        privacy: s.privacy,
        expiresAt: s.expiresAt,
        createdAt: s.createdAt,
        user: safeUser,
        isViewed: s.views.length > 0,
        myReaction: s.reactions[0] ?? null,
      });
    }

    // Group by user for WhatsApp Stories tray
    const groupedMap = new Map<string, StatusGroupItem>();
    for (const item of visibleStatuses) {
      let group = groupedMap.get(item.userId);
      if (!group) {
        group = { user: item.user, statuses: [], hasUnviewed: false };
        groupedMap.set(item.userId, group);
      }
      group.statuses.push(item);
      if (!item.isViewed) {
        group.hasUnviewed = true;
      }
    }

    return Array.from(groupedMap.values());
  }

  async getMyStatuses(userId: string) {
    const now = new Date();
    const statuses = await this.prisma.status.findMany({
      where: {
        userId,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { views: true, reactions: true },
        },
        views: {
          orderBy: { viewedAt: 'desc' },
          include: {
            viewer: {
              select: {
                id: true,
                displayName: true,
                username: true,
                avatarUrl: true,
              },
            },
          },
        },
        reactions: {
          orderBy: { createdAt: 'desc' },
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
        },
      },
    });

    return statuses;
  }

  async deleteStatus(statusId: string, userId: string) {
    const status = await this.prisma.status.findUnique({
      where: { id: statusId },
    });
    if (!status) {
      throw new NotFoundException('Status not found');
    }
    if (status.userId !== userId) {
      throw new ForbiddenException('You can only delete your own status');
    }

    await this.prisma.status.delete({ where: { id: statusId } });
    await this.redis.del(`${STATUS_SELECTED_KEY_PREFIX}${statusId}`);
    return { id: statusId, deleted: true };
  }

  async viewStatus(statusId: string, viewerId: string) {
    const status = await this.assertStatusAccessible(statusId, viewerId);

    if (status.userId === viewerId) {
      return { statusId, viewerId, selfView: true };
    }

    const view = await this.prisma.statusView.upsert({
      where: {
        statusId_viewerId: { statusId, viewerId },
      },
      update: {
        viewedAt: new Date(),
      },
      create: {
        statusId,
        viewerId,
      },
    });

    return view;
  }

  async getStatusViewers(statusId: string, ownerId: string) {
    const status = await this.prisma.status.findUnique({
      where: { id: statusId },
    });
    if (!status) {
      throw new NotFoundException('Status not found');
    }
    if (status.userId !== ownerId) {
      throw new ForbiddenException('Only the status owner can view the viewers list');
    }

    const [views, reactions] = await Promise.all([
      this.prisma.statusView.findMany({
        where: { statusId },
        orderBy: { viewedAt: 'desc' },
        include: {
          viewer: {
            select: {
              id: true,
              displayName: true,
              username: true,
              avatarUrl: true,
              phoneNumber: true,
            },
          },
        },
      }),
      this.prisma.statusReaction.findMany({
        where: { statusId },
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

    return {
      statusId,
      totalViews: views.length,
      viewers: views,
      reactions,
    };
  }

  async reactToStatus(statusId: string, userId: string, emoji: string) {
    await this.assertStatusAccessible(statusId, userId);

    const reaction = await this.prisma.statusReaction.upsert({
      where: {
        statusId_userId: { statusId, userId },
      },
      update: { emoji },
      create: {
        statusId,
        userId,
        emoji,
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

    return reaction;
  }

  async replyToStatus(statusId: string, userId: string, messageText: string) {
    const status = await this.assertStatusAccessible(statusId, userId);

    if (status.userId === userId) {
      throw new BadRequestException('Cannot reply to your own status');
    }

    // Find existing direct conversation between userId and status.userId
    const existingConversation = await this.prisma.conversation.findFirst({
      where: {
        type: ConversationType.DIRECT,
        AND: [
          { members: { some: { userId, isActive: true } } },
          { members: { some: { userId: status.userId, isActive: true } } },
        ],
      },
    });

    const result = await this.prisma.$transaction(async (tx) => {
      let conversationId = existingConversation?.id;

      if (!conversationId) {
        const conversation = await tx.conversation.create({
          data: {
            type: ConversationType.DIRECT,
            createdBy: userId,
            members: {
              create: [
                { userId, role: MemberRole.MEMBER },
                { userId: status.userId, role: MemberRole.MEMBER },
              ],
            },
          },
        });
        conversationId = conversation.id;
      }

      const statusPreview =
        status.textContent ?? status.caption ?? `[${status.contentType} Status]`;

      const message = await tx.message.create({
        data: {
          conversationId,
          senderId: userId,
          content: messageText,
          messageType: MessageType.TEXT,
          encryptionMetadata: {
            statusReply: {
              statusId: status.id,
              contentType: status.contentType,
              preview: statusPreview.slice(0, 120),
            },
          },
        },
        include: {
          sender: {
            select: {
              id: true,
              displayName: true,
              avatarUrl: true,
            },
          },
        },
      });

      await tx.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });

      await tx.conversationMember.updateMany({
        where: {
          conversationId,
          userId: status.userId,
        },
        data: {
          unreadCount: { increment: 1 },
        },
      });

      return { conversationId, message };
    });

    return result;
  }

  async deleteExpiredStatuses(): Promise<number> {
    const now = new Date();
    const expired = await this.prisma.status.findMany({
      where: { expiresAt: { lt: now } },
      select: { id: true },
    });

    if (expired.length === 0) {
      return 0;
    }

    const ids = expired.map((s) => s.id);
    const deleted = await this.prisma.status.deleteMany({
      where: { id: { in: ids } },
    });

    try {
      await this.redis.getClient().zrem(STATUS_EXPIRY_ZSET, ...ids);
    } catch {
      // Ignore Redis cleanup failures
    }

    this.logger.log(`Deleted ${deleted.count} expired statuses`);
    return deleted.count;
  }

  private async assertStatusAccessible(statusId: string, viewerId: string) {
    const status = await this.prisma.status.findUnique({
      where: { id: statusId },
    });

    if (!status) {
      throw new NotFoundException('Status not found');
    }

    if (status.expiresAt <= new Date()) {
      throw new NotFoundException('Status has expired');
    }

    if (status.userId === viewerId) {
      return status;
    }

    const blocked = await this.prisma.blockedUser.findFirst({
      where: {
        OR: [
          { blockerId: status.userId, blockedId: viewerId },
          { blockerId: viewerId, blockedId: status.userId },
        ],
      },
    });
    if (blocked) {
      throw new ForbiddenException('You do not have access to this status');
    }

    if (status.privacy === StatusPrivacy.NONE) {
      throw new ForbiddenException('This status is private');
    }

    if (status.privacy === StatusPrivacy.SELECTED) {
      const selectedRaw = await this.redis.get(`${STATUS_SELECTED_KEY_PREFIX}${status.id}`);
      const selectedIds: string[] = selectedRaw ? JSON.parse(selectedRaw) : [];
      if (!selectedIds.includes(viewerId)) {
        throw new ForbiddenException('You do not have access to this status');
      }
    }

    if (status.privacy === StatusPrivacy.CONTACTS) {
      const [isContact, directConversation] = await Promise.all([
        this.prisma.contact.findUnique({
          where: {
            ownerId_contactId: {
              ownerId: status.userId,
              contactId: viewerId,
            },
          },
        }),
        this.prisma.conversation.findFirst({
          where: {
            type: ConversationType.DIRECT,
            AND: [
              { members: { some: { userId: status.userId, isActive: true, leftAt: null } } },
              { members: { some: { userId: viewerId, isActive: true, leftAt: null } } },
            ],
          },
          select: { id: true },
        }),
      ]);
      if (!isContact && !directConversation) {
        throw new ForbiddenException('Status is visible to contacts only');
      }
    }

    return status;
  }

  private mapVisibilityToStatusPrivacy(scope: StatusVisibilityScope): StatusPrivacy {
    switch (scope) {
      case StatusVisibilityScope.ALL:
        return StatusPrivacy.ALL;
      case StatusVisibilityScope.CONTACTS:
        return StatusPrivacy.CONTACTS;
      case StatusVisibilityScope.SELECTED:
        return StatusPrivacy.SELECTED;
      case StatusVisibilityScope.NOBODY:
        return StatusPrivacy.NONE;
      default:
        return StatusPrivacy.CONTACTS;
    }
  }
}

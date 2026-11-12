import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConversationType, MemberRole } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { UpdateCommunityDto } from './dto/update-community.dto';

const COMMUNITY_GROUPS_CONFIG_PREFIX = 'community_groups:';

@Injectable()
export class CommunitiesService {
  constructor(private readonly prisma: PrismaService) {}

  async createCommunity(creatorId: string, dto: CreateCommunityDto) {
    const uniqueOtherMemberIds = Array.from(
      new Set((dto.memberIds ?? []).filter((id) => id !== creatorId)),
    );

    if (uniqueOtherMemberIds.length > 0) {
      const validUsers = await this.prisma.user.findMany({
        where: {
          id: { in: uniqueOtherMemberIds },
          isActive: true,
          deletedAt: null,
        },
        select: { id: true },
      });

      if (validUsers.length !== uniqueOtherMemberIds.length) {
        throw new BadRequestException('One or more memberIds are invalid or inactive');
      }
    }

    const avatarUrl = dto.avatarUrl ?? dto.avatar ?? null;
    const inviteLink = randomBytes(10).toString('base64url');

    return this.prisma.$transaction(async (tx) => {
      const community = await tx.community.create({
        data: {
          name: dto.name,
          description: dto.description ?? null,
          avatarUrl,
          inviteLink,
          createdBy: creatorId,
        },
      });

      await tx.communityMember.createMany({
        data: [
          {
            communityId: community.id,
            userId: creatorId,
            role: MemberRole.OWNER,
            isActive: true,
          },
          ...uniqueOtherMemberIds.map((userId) => ({
            communityId: community.id,
            userId,
            role: MemberRole.MEMBER,
            isActive: true,
          })),
        ],
      });

      const announcementConversation = await tx.conversation.create({
        data: {
          type: ConversationType.COMMUNITY,
          createdBy: creatorId,
        },
      });

      await tx.conversationMember.createMany({
        data: [
          {
            conversationId: announcementConversation.id,
            userId: creatorId,
            role: MemberRole.OWNER,
            isActive: true,
          },
          ...uniqueOtherMemberIds.map((userId) => ({
            conversationId: announcementConversation.id,
            userId,
            role: MemberRole.MEMBER,
            isActive: true,
          })),
        ],
      });

      await tx.systemConfig.upsert({
        where: { key: `${COMMUNITY_GROUPS_CONFIG_PREFIX}${community.id}` },
        create: {
          key: `${COMMUNITY_GROUPS_CONFIG_PREFIX}${community.id}`,
          value: { groupIds: [], announcementConversationId: announcementConversation.id },
          updatedBy: creatorId,
        },
        update: {
          value: { groupIds: [], announcementConversationId: announcementConversation.id },
          updatedBy: creatorId,
        },
      });

      const fullCommunity = await tx.community.findUnique({
        where: { id: community.id },
        include: {
          members: {
            where: { isActive: true },
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
        },
      });

      return {
        ...fullCommunity,
        announcementConversationId: announcementConversation.id,
        groups: [],
      };
    }, { maxWait: 10000, timeout: 15000 });
  }

  async getUserCommunities(userId: string) {
    const communities = await this.prisma.community.findMany({
      where: {
        deletedAt: null,
        members: {
          some: { userId, isActive: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        members: {
          where: { isActive: true },
          include: {
            user: {
              select: {
                id: true,
                displayName: true,
                avatarUrl: true,
                phoneNumber: true,
                username: true,
              },
            },
          },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });

    if (communities.length === 0) {
      return [];
    }

    const configKeys = communities.map(
      (c) => `${COMMUNITY_GROUPS_CONFIG_PREFIX}${c.id}`,
    );

    const configs = await this.prisma.systemConfig.findMany({
      where: { key: { in: configKeys } },
    });

    const metaByCommunityId = new Map<
      string,
      { groupIds: string[]; announcementConversationId?: string }
    >();
    const allGroupIds = new Set<string>();

    for (const cfg of configs ?? []) {
      const communityId = cfg.key.slice(COMMUNITY_GROUPS_CONFIG_PREFIX.length);
      const raw = (cfg.value ?? {}) as {
        groupIds?: unknown;
        announcementConversationId?: unknown;
      };
      const groupIds = Array.isArray(raw.groupIds)
        ? raw.groupIds.filter((id): id is string => typeof id === 'string')
        : [];
      for (const gid of groupIds) {
        allGroupIds.add(gid);
      }
      metaByCommunityId.set(communityId, {
        groupIds,
        announcementConversationId:
          typeof raw.announcementConversationId === 'string'
            ? raw.announcementConversationId
            : undefined,
      });
    }

    const groupsList =
      allGroupIds.size > 0
        ? await this.prisma.group.findMany({
            where: { id: { in: Array.from(allGroupIds) }, deletedAt: null },
            include: {
              _count: { select: { members: true } },
              conversations: { select: { id: true } },
            },
          })
        : [];

    const groupById = new Map(groupsList.map((g) => [g.id, g]));

    return communities.map((community) => {
      const meta = metaByCommunityId.get(community.id);
      const linkedGroups = (meta?.groupIds ?? [])
        .map((gid) => groupById.get(gid))
        .filter((g): g is NonNullable<typeof g> => Boolean(g));

      return {
        ...community,
        announcementConversationId: meta?.announcementConversationId,
        groups: linkedGroups,
      };
    });
  }

  async getCommunityById(communityId: string, userId: string) {
    const community = await this.prisma.community.findFirst({
      where: { id: communityId, deletedAt: null },
      include: {
        members: {
          where: { isActive: true },
          include: {
            user: {
              select: {
                id: true,
                displayName: true,
                avatarUrl: true,
                phoneNumber: true,
                username: true,
              },
            },
          },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });

    if (!community) {
      throw new NotFoundException('Community not found');
    }

    const isMember = community.members.some((m) => m.userId === userId);
    if (!isMember) {
      throw new ForbiddenException('You are not an active member of this community');
    }

    const { groupIds, announcementConversationId } =
      await this.getCommunityMetadata(communityId);

    const groups =
      groupIds.length > 0
        ? await this.prisma.group.findMany({
            where: { id: { in: groupIds }, deletedAt: null },
            include: {
              _count: { select: { members: true } },
              conversations: { select: { id: true } },
            },
          })
        : [];

    return {
      ...community,
      announcementConversationId,
      groups,
    };
  }

  async updateCommunity(
    communityId: string,
    adminId: string,
    dto: UpdateCommunityDto,
  ) {
    await this.validateAdminPermission(communityId, adminId);

    const updateData: Record<string, unknown> = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.avatarUrl !== undefined || dto.avatar !== undefined) {
      updateData.avatarUrl = dto.avatarUrl ?? dto.avatar;
    }

    return this.prisma.community.update({
      where: { id: communityId },
      data: updateData,
    });
  }

  async deleteCommunity(communityId: string, ownerId: string) {
    const community = await this.prisma.community.findFirst({
      where: { id: communityId, deletedAt: null },
    });

    if (!community) {
      throw new NotFoundException('Community not found');
    }

    const membership = await this.prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId, userId: ownerId } },
    });

    const isOwner =
      community.createdBy === ownerId ||
      (membership?.isActive && membership.role === MemberRole.OWNER);

    if (!isOwner) {
      throw new ForbiddenException('Only the community owner can delete this community');
    }

    const now = new Date();
    await this.prisma.$transaction(
      async (tx) => {
        await tx.community.update({
          where: { id: communityId },
          data: { deletedAt: now, inviteLink: null },
        });

        await tx.communityMember.updateMany({
          where: { communityId, isActive: true },
          data: { isActive: false },
        });
      },
      { maxWait: 10000, timeout: 15000 },
    );

    return { deleted: true, communityId };
  }

  async getMembers(communityId: string, userId: string) {
    await this.validateActiveMembership(communityId, userId);

    return this.prisma.communityMember.findMany({
      where: { communityId, isActive: true },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
            phoneNumber: true,
            username: true,
            about: true,
          },
        },
      },
      orderBy: [{ role: 'desc' }, { joinedAt: 'asc' }],
    });
  }

  async addMembers(communityId: string, adminId: string, userIds: string[]) {
    await this.validateAdminPermission(communityId, adminId);

    const uniqueUserIds = Array.from(new Set(userIds));
    const validUsers = await this.prisma.user.findMany({
      where: {
        id: { in: uniqueUserIds },
        isActive: true,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (validUsers.length !== uniqueUserIds.length) {
      throw new BadRequestException('One or more userIds are invalid or inactive');
    }

    const { announcementConversationId } =
      await this.getCommunityMetadata(communityId);

    await this.prisma.$transaction(async (tx) => {
      for (const targetUserId of uniqueUserIds) {
        await tx.communityMember.upsert({
          where: {
            communityId_userId: { communityId, userId: targetUserId },
          },
          create: {
            communityId,
            userId: targetUserId,
            role: MemberRole.MEMBER,
            isActive: true,
          },
          update: {
            isActive: true,
            joinedAt: new Date(),
          },
        });

        if (announcementConversationId) {
          await tx.conversationMember.upsert({
            where: {
              conversationId_userId: {
                conversationId: announcementConversationId,
                userId: targetUserId,
              },
            },
            create: {
              conversationId: announcementConversationId,
              userId: targetUserId,
              role: MemberRole.MEMBER,
              isActive: true,
            },
            update: {
              isActive: true,
              leftAt: null,
              joinedAt: new Date(),
            },
          });
        }
      }
    });

    return this.getMembers(communityId, adminId);
  }

  async removeMember(
    communityId: string,
    actorId: string,
    targetUserId: string,
  ) {
    const community = await this.prisma.community.findFirst({
      where: { id: communityId, deletedAt: null },
    });
    if (!community) {
      throw new NotFoundException('Community not found');
    }

    const targetMembership = await this.prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId, userId: targetUserId } },
    });

    if (!targetMembership || !targetMembership.isActive) {
      throw new NotFoundException('Target user is not an active community member');
    }

    if (actorId !== targetUserId) {
      await this.validateAdminPermission(communityId, actorId);
      if (targetMembership.role === MemberRole.OWNER) {
        throw new ForbiddenException('Cannot remove the community owner');
      }
    } else if (targetMembership.role === MemberRole.OWNER) {
      throw new BadRequestException(
        'Community owner cannot leave without deleting the community',
      );
    }

    const { announcementConversationId } =
      await this.getCommunityMetadata(communityId);

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.communityMember.update({
        where: { communityId_userId: { communityId, userId: targetUserId } },
        data: { isActive: false },
      });

      if (announcementConversationId) {
        await tx.conversationMember.updateMany({
          where: {
            conversationId: announcementConversationId,
            userId: targetUserId,
          },
          data: { isActive: false, leftAt: now },
        });
      }
    });

    return { removed: true, communityId, userId: targetUserId };
  }

  async addGroupToCommunity(
    communityId: string,
    adminId: string,
    groupId: string,
  ) {
    await this.validateAdminPermission(communityId, adminId);

    const group = await this.prisma.group.findFirst({
      where: { id: groupId, deletedAt: null },
    });

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    const metadata = await this.getCommunityMetadata(communityId);
    const updatedGroupIds = Array.from(new Set([...metadata.groupIds, groupId]));

    await this.prisma.systemConfig.upsert({
      where: { key: `${COMMUNITY_GROUPS_CONFIG_PREFIX}${communityId}` },
      create: {
        key: `${COMMUNITY_GROUPS_CONFIG_PREFIX}${communityId}`,
        value: {
          ...metadata,
          groupIds: updatedGroupIds,
        },
        updatedBy: adminId,
      },
      update: {
        value: {
          ...metadata,
          groupIds: updatedGroupIds,
        },
        updatedBy: adminId,
      },
    });

    return {
      communityId,
      groupId,
      groupIds: updatedGroupIds,
    };
  }

  async removeGroupFromCommunity(
    communityId: string,
    adminId: string,
    groupId: string,
  ) {
    await this.validateAdminPermission(communityId, adminId);

    const metadata = await this.getCommunityMetadata(communityId);
    const updatedGroupIds = metadata.groupIds.filter((id) => id !== groupId);

    await this.prisma.systemConfig.upsert({
      where: { key: `${COMMUNITY_GROUPS_CONFIG_PREFIX}${communityId}` },
      create: {
        key: `${COMMUNITY_GROUPS_CONFIG_PREFIX}${communityId}`,
        value: {
          ...metadata,
          groupIds: updatedGroupIds,
        },
        updatedBy: adminId,
      },
      update: {
        value: {
          ...metadata,
          groupIds: updatedGroupIds,
        },
        updatedBy: adminId,
      },
    });

    return {
      removed: true,
      communityId,
      groupId,
      groupIds: updatedGroupIds,
    };
  }

  private async getCommunityMetadata(communityId: string): Promise<{
    groupIds: string[];
    announcementConversationId?: string;
  }> {
    const config = await this.prisma.systemConfig.findUnique({
      where: { key: `${COMMUNITY_GROUPS_CONFIG_PREFIX}${communityId}` },
    });

    const raw = (config?.value ?? {}) as {
      groupIds?: unknown;
      announcementConversationId?: unknown;
    };

    return {
      groupIds: Array.isArray(raw.groupIds)
        ? raw.groupIds.filter((id): id is string => typeof id === 'string')
        : [],
      announcementConversationId:
        typeof raw.announcementConversationId === 'string'
          ? raw.announcementConversationId
          : undefined,
    };
  }

  private async validateAdminPermission(
    communityId: string,
    userId: string,
  ): Promise<void> {
    const community = await this.prisma.community.findFirst({
      where: { id: communityId, deletedAt: null },
      select: { id: true },
    });

    if (!community) {
      throw new NotFoundException('Community not found');
    }

    const membership = await this.prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId, userId } },
    });

    if (
      !membership ||
      !membership.isActive ||
      (membership.role !== MemberRole.ADMIN && membership.role !== MemberRole.OWNER)
    ) {
      throw new ForbiddenException('Community admin or owner permission required');
    }
  }

  private async validateActiveMembership(
    communityId: string,
    userId: string,
  ): Promise<void> {
    const community = await this.prisma.community.findFirst({
      where: { id: communityId, deletedAt: null },
      select: { id: true },
    });

    if (!community) {
      throw new NotFoundException('Community not found');
    }

    const membership = await this.prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId, userId } },
    });

    if (!membership || !membership.isActive) {
      throw new ForbiddenException('You are not an active member of this community');
    }
  }
}

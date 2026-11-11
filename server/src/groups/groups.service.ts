import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConversationType, MemberRole } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';

@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Create a new group, linked GROUP conversation, and initial group/conversation members.
   */
  async createGroup(creatorId: string, dto: CreateGroupDto) {
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

    const result = await this.prisma.$transaction(async (tx) => {
      const group = await tx.group.create({
        data: {
          name: dto.name,
          description: dto.description ?? null,
          avatarUrl,
          createdBy: creatorId,
        },
      });

      const conversation = await tx.conversation.create({
        data: {
          type: ConversationType.GROUP,
          createdBy: creatorId,
          groupId: group.id,
        },
      });

      const groupMembersData = [
        {
          groupId: group.id,
          userId: creatorId,
          role: MemberRole.OWNER,
          addedBy: creatorId,
          isActive: true,
        },
        ...uniqueOtherMemberIds.map((memberId) => ({
          groupId: group.id,
          userId: memberId,
          role: MemberRole.MEMBER,
          addedBy: creatorId,
          isActive: true,
        })),
      ];

      await tx.groupMember.createMany({ data: groupMembersData });

      const conversationMembersData = [
        {
          conversationId: conversation.id,
          userId: creatorId,
          role: MemberRole.OWNER,
          isActive: true,
        },
        ...uniqueOtherMemberIds.map((memberId) => ({
          conversationId: conversation.id,
          userId: memberId,
          role: MemberRole.MEMBER,
          isActive: true,
        })),
      ];

      await tx.conversationMember.createMany({ data: conversationMembersData });

      return tx.group.findUnique({
        where: { id: group.id },
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
          },
          conversations: {
            select: { id: true, type: true, createdAt: true },
          },
        },
      });
    });

    if (result) {
      await this.notificationsService.sendGroupNotification(
        'GROUP_CREATED',
        result.id,
        creatorId,
      );
    }

    return result;
  }

  /**
   * Fetch group details and active members (only accessible to active members).
   */
  async getGroupById(groupId: string, userId: string) {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, deletedAt: null },
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
                about: true,
              },
            },
          },
          orderBy: { joinedAt: 'asc' },
        },
        conversations: {
          select: { id: true, type: true, disappearingMessagesTimeout: true },
        },
        invites: {
          where: { isActive: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    const isMember = group.members.some((m) => m.userId === userId);
    if (!isMember) {
      throw new ForbiddenException('You are not an active member of this group');
    }

    return {
      ...group,
      conversationId: group.conversations[0]?.id ?? null,
    };
  }

  /**
   * Update group name, description, avatar, or group permission settings (admin/owner only).
   */
  async updateGroup(groupId: string, adminId: string, dto: UpdateGroupDto) {
    await this.validateAdminPermission(groupId, adminId);

    const updateData: Record<string, unknown> = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.avatarUrl !== undefined || dto.avatar !== undefined) {
      updateData.avatarUrl = dto.avatarUrl ?? dto.avatar;
    }
    if (dto.onlyAdminsCanMessage !== undefined) {
      updateData.onlyAdminsCanMessage = dto.onlyAdminsCanMessage;
    }
    if (dto.onlyAdminsCanEditInfo !== undefined) {
      updateData.onlyAdminsCanEditInfo = dto.onlyAdminsCanEditInfo;
    }

    const updated = await this.prisma.group.update({
      where: { id: groupId },
      data: updateData,
      include: {
        conversations: { select: { id: true } },
      },
    });

    await this.notificationsService.sendGroupNotification(
      'GROUP_UPDATED',
      groupId,
      adminId,
    );

    return updated;
  }

  /**
   * Soft-delete a group (owner only) and deactivate all memberships.
   */
  async deleteGroup(groupId: string, ownerId: string) {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, deletedAt: null },
      include: { conversations: { select: { id: true } } },
    });

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    const membership = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: ownerId } },
    });

    const isOwner =
      group.createdBy === ownerId ||
      (membership?.isActive && membership.role === MemberRole.OWNER);

    if (!isOwner) {
      throw new ForbiddenException('Only the group owner can delete this group');
    }

    const now = new Date();
    const conversationIds = group.conversations.map((c) => c.id);

    await this.prisma.$transaction(async (tx) => {
      await tx.group.update({
        where: { id: groupId },
        data: { deletedAt: now, inviteLinkEnabled: false, inviteLink: null },
      });

      await tx.groupMember.updateMany({
        where: { groupId, isActive: true },
        data: { isActive: false },
      });

      await tx.groupInvite.updateMany({
        where: { groupId, isActive: true },
        data: { isActive: false },
      });

      if (conversationIds.length > 0) {
        await tx.conversationMember.updateMany({
          where: { conversationId: { in: conversationIds }, isActive: true },
          data: { isActive: false, leftAt: now },
        });
      }
    });

    return { deleted: true, groupId };
  }

  /**
   * List active members of a group.
   */
  async getMembers(groupId: string, userId: string) {
    await this.validateActiveMembership(groupId, userId);

    return this.prisma.groupMember.findMany({
      where: { groupId, isActive: true },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
            phoneNumber: true,
            username: true,
            about: true,
            profile: {
              select: { isOnline: true, lastSeen: true },
            },
          },
        },
      },
      orderBy: [{ role: 'desc' }, { joinedAt: 'asc' }],
    });
  }

  /**
   * Add users to a group and its linked conversation (admin/owner only).
   */
  async addMembers(groupId: string, adminId: string, userIds: string[]) {
    await this.validateAdminPermission(groupId, adminId);

    const uniqueUserIds = Array.from(new Set(userIds));
    if (uniqueUserIds.length === 0) {
      throw new BadRequestException('At least one userId is required');
    }

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

    const conversation = await this.prisma.conversation.findFirst({
      where: { groupId },
      select: { id: true },
    });

    await this.prisma.$transaction(async (tx) => {
      for (const targetUserId of uniqueUserIds) {
        await tx.groupMember.upsert({
          where: { groupId_userId: { groupId, userId: targetUserId } },
          create: {
            groupId,
            userId: targetUserId,
            role: MemberRole.MEMBER,
            addedBy: adminId,
            isActive: true,
          },
          update: {
            isActive: true,
            addedBy: adminId,
            joinedAt: new Date(),
          },
        });

        if (conversation) {
          await tx.conversationMember.upsert({
            where: {
              conversationId_userId: {
                conversationId: conversation.id,
                userId: targetUserId,
              },
            },
            create: {
              conversationId: conversation.id,
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

    await this.notificationsService.sendGroupNotification(
      'GROUP_MEMBER_ADDED',
      groupId,
      adminId,
      { addedUserIds: uniqueUserIds },
    );

    return this.getMembers(groupId, adminId);
  }

  /**
   * Remove a member from the group (admins can remove others; any member can remove self).
   */
  async removeMember(groupId: string, actorId: string, targetUserId: string) {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, deletedAt: null },
    });
    if (!group) {
      throw new NotFoundException('Group not found');
    }

    const targetMembership = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: targetUserId } },
    });

    if (!targetMembership || !targetMembership.isActive) {
      throw new NotFoundException('Target user is not an active member of this group');
    }

    if (actorId !== targetUserId) {
      await this.validateAdminPermission(groupId, actorId);
      if (targetMembership.role === MemberRole.OWNER) {
        throw new ForbiddenException('Cannot remove the group owner');
      }
    } else if (targetMembership.role === MemberRole.OWNER) {
      throw new BadRequestException(
        'Group owner cannot leave without deleting the group',
      );
    }

    const conversation = await this.prisma.conversation.findFirst({
      where: { groupId },
      select: { id: true },
    });

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.groupMember.update({
        where: { groupId_userId: { groupId, userId: targetUserId } },
        data: { isActive: false },
      });

      if (conversation) {
        await tx.conversationMember.updateMany({
          where: {
            conversationId: conversation.id,
            userId: targetUserId,
          },
          data: { isActive: false, leftAt: now },
        });
      }
    });

    await this.notificationsService.sendGroupNotification(
      'GROUP_MEMBER_REMOVED',
      groupId,
      actorId,
      { removedUserId: targetUserId },
    );

    return { removed: true, groupId, userId: targetUserId };
  }

  /**
   * Promote or demote a group member's role (ADMIN / MEMBER).
   */
  async promoteMember(
    groupId: string,
    adminId: string,
    targetUserId: string,
    role: MemberRole = MemberRole.ADMIN,
  ) {
    await this.validateAdminPermission(groupId, adminId);

    if (role === MemberRole.OWNER) {
      throw new BadRequestException('Cannot assign OWNER role via promotion endpoint');
    }

    const targetMembership = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: targetUserId } },
    });

    if (!targetMembership || !targetMembership.isActive) {
      throw new NotFoundException('Target user is not an active member of this group');
    }

    if (targetMembership.role === MemberRole.OWNER) {
      throw new ForbiddenException('Cannot change the role of the group owner');
    }

    const conversation = await this.prisma.conversation.findFirst({
      where: { groupId },
      select: { id: true },
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedMember = await tx.groupMember.update({
        where: { groupId_userId: { groupId, userId: targetUserId } },
        data: { role },
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
      });

      if (conversation) {
        await tx.conversationMember.updateMany({
          where: { conversationId: conversation.id, userId: targetUserId },
          data: { role },
        });
      }

      return updatedMember;
    });

    await this.notificationsService.sendGroupNotification(
      'GROUP_MEMBER_ROLE_UPDATED',
      groupId,
      adminId,
      { targetUserId, role },
    );

    return updated;
  }

  /**
   * Generate a new invite link code for the group (admin/owner only).
   */
  async generateInviteLink(
    groupId: string,
    adminId: string,
    options?: { expiresAt?: Date; maxUses?: number },
  ) {
    await this.validateAdminPermission(groupId, adminId);

    const inviteCode = randomBytes(12).toString('base64url');

    const invite = await this.prisma.$transaction(async (tx) => {
      await tx.groupInvite.updateMany({
        where: { groupId, isActive: true },
        data: { isActive: false },
      });

      const createdInvite = await tx.groupInvite.create({
        data: {
          groupId,
          inviteCode,
          createdBy: adminId,
          expiresAt: options?.expiresAt ?? null,
          maxUses: options?.maxUses ?? null,
          isActive: true,
        },
      });

      await tx.group.update({
        where: { id: groupId },
        data: {
          inviteLink: inviteCode,
          inviteLinkEnabled: true,
        },
      });

      return createdInvite;
    });

    return {
      ...invite,
      inviteUrl: `/groups/join/${invite.inviteCode}`,
    };
  }

  /**
   * Revoke all active invite links for a group (admin/owner only).
   */
  async revokeInviteLink(groupId: string, adminId: string) {
    await this.validateAdminPermission(groupId, adminId);

    await this.prisma.$transaction(async (tx) => {
      await tx.groupInvite.updateMany({
        where: { groupId, isActive: true },
        data: { isActive: false },
      });

      await tx.group.update({
        where: { id: groupId },
        data: {
          inviteLink: null,
          inviteLinkEnabled: false,
        },
      });
    });

    return { revoked: true, groupId };
  }

  /**
   * Join a group using an active invite code.
   */
  async joinViaInviteLink(inviteCode: string, userId: string) {
    const invite = await this.prisma.groupInvite.findUnique({
      where: { inviteCode },
      include: {
        group: {
          include: {
            conversations: { select: { id: true } },
          },
        },
      },
    });

    if (
      !invite ||
      !invite.isActive ||
      !invite.group ||
      invite.group.deletedAt !== null ||
      !invite.group.inviteLinkEnabled
    ) {
      throw new NotFoundException('Invite link is invalid or has been revoked');
    }

    if (invite.expiresAt && invite.expiresAt < new Date()) {
      throw new BadRequestException('Invite link has expired');
    }

    if (invite.maxUses !== null && invite.useCount >= invite.maxUses) {
      throw new BadRequestException('Invite link has reached its maximum usage limit');
    }

    const existingMembership = await this.prisma.groupMember.findUnique({
      where: {
        groupId_userId: { groupId: invite.groupId, userId },
      },
    });

    if (existingMembership?.isActive) {
      return {
        alreadyMember: true,
        group: invite.group,
        conversationId: invite.group.conversations[0]?.id ?? null,
      };
    }

    const conversationId = invite.group.conversations[0]?.id;

    await this.prisma.$transaction(async (tx) => {
      await tx.groupInvite.update({
        where: { id: invite.id },
        data: { useCount: { increment: 1 } },
      });

      await tx.groupMember.upsert({
        where: { groupId_userId: { groupId: invite.groupId, userId } },
        create: {
          groupId: invite.groupId,
          userId,
          role: MemberRole.MEMBER,
          addedBy: invite.createdBy,
          isActive: true,
        },
        update: {
          isActive: true,
          role: MemberRole.MEMBER,
          joinedAt: new Date(),
        },
      });

      if (conversationId) {
        await tx.conversationMember.upsert({
          where: {
            conversationId_userId: { conversationId, userId },
          },
          create: {
            conversationId,
            userId,
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
    });

    await this.notificationsService.sendGroupNotification(
      'GROUP_MEMBER_ADDED',
      invite.groupId,
      userId,
      { joinedUserId: userId },
    );

    return {
      joined: true,
      group: invite.group,
      conversationId: conversationId ?? null,
    };
  }

  /**
   * Fetch all shared media attachments in a group's conversation.
   */
  async getGroupMedia(
    groupId: string,
    userId: string,
    cursor?: string,
    limit = 20,
  ) {
    await this.validateActiveMembership(groupId, userId);

    const conversation = await this.prisma.conversation.findFirst({
      where: { groupId },
      select: { id: true },
    });

    if (!conversation) {
      return { items: [], nextCursor: null, hasMore: false };
    }

    const take = Math.min(Math.max(limit, 1), 100);
    const rows = await this.prisma.messageAttachment.findMany({
      where: {
        message: {
          conversationId: conversation.id,
          isDeletedForEveryone: false,
        },
      },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: {
        message: {
          select: {
            id: true,
            senderId: true,
            messageType: true,
            createdAt: true,
            sender: {
              select: {
                id: true,
                displayName: true,
                avatarUrl: true,
              },
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
   * Validate that a user is an active ADMIN or OWNER of the group.
   */
  async validateAdminPermission(groupId: string, userId: string): Promise<void> {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, deletedAt: null },
      select: { id: true },
    });

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    const membership = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });

    if (
      !membership ||
      !membership.isActive ||
      (membership.role !== MemberRole.ADMIN && membership.role !== MemberRole.OWNER)
    ) {
      throw new ForbiddenException('Admin or owner permission required');
    }
  }

  private async validateActiveMembership(
    groupId: string,
    userId: string,
  ): Promise<void> {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, deletedAt: null },
      select: { id: true },
    });

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    const membership = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });

    if (!membership || !membership.isActive) {
      throw new ForbiddenException('You are not an active member of this group');
    }
  }
}

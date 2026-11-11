import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { VisibilityScope } from '@prisma/client';
import { OtpService } from '../otp/otp.service';
import { PrismaService } from '../prisma/prisma.service';
import { SearchUsersDto, UserSearchType } from './dto/search-users.dto';
import { AddContactDto, SyncContactsDto } from './dto/sync-contacts.dto';
import { ChangeNumberDto, UpdateProfileDto } from './dto/update-profile.dto';

const CONTACT_USER_INCLUDE = {
  contactUser: {
    select: {
      id: true,
      phoneNumber: true,
      countryCode: true,
      username: true,
      displayName: true,
      about: true,
      avatarUrl: true,
      profile: {
        select: {
          isOnline: true,
          lastSeen: true,
        },
      },
    },
  },
} as const;

const SAFE_USER_SELECT = {
  id: true,
  phoneNumber: true,
  countryCode: true,
  username: true,
  displayName: true,
  about: true,
  avatarUrl: true,
  role: true,
  isVerified: true,
  isActive: true,
  isBanned: true,
  twoFactorEnabled: true,
  recoveryEmail: true,
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otpService: OtpService,
  ) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        ...SAFE_USER_SELECT,
        profile: true,
        privacySettings: true,
        chatSettings: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateMe(userId: string, dto: UpdateProfileDto) {
    if (dto.username) {
      const existing = await this.prisma.user.findUnique({
        where: { username: dto.username },
      });
      if (existing && existing.id !== userId) {
        throw new ConflictException('Username is already taken');
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.display_name !== undefined ? { displayName: dto.display_name } : {}),
        ...(dto.username !== undefined ? { username: dto.username } : {}),
        ...(dto.about !== undefined ? { about: dto.about } : {}),
        ...(dto.avatar_url !== undefined ? { avatarUrl: dto.avatar_url } : {}),
        ...(dto.recovery_email !== undefined ? { recoveryEmail: dto.recovery_email } : {}),
        ...(dto.push_notification_token !== undefined ||
        dto.platform !== undefined ||
        dto.app_version !== undefined
          ? {
              profile: {
                upsert: {
                  create: {
                    pushNotificationToken: dto.push_notification_token,
                    platform: dto.platform,
                    appVersion: dto.app_version,
                  },
                  update: {
                    ...(dto.push_notification_token !== undefined
                      ? { pushNotificationToken: dto.push_notification_token }
                      : {}),
                    ...(dto.platform !== undefined ? { platform: dto.platform } : {}),
                    ...(dto.app_version !== undefined ? { appVersion: dto.app_version } : {}),
                  },
                },
              },
            }
          : {}),
      },
      select: {
        ...SAFE_USER_SELECT,
        profile: true,
      },
    });

    return updated;
  }

  async deleteMe(userId: string) {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          isActive: false,
          deletedAt: new Date(),
        },
      }),
      this.prisma.authenticationSession.updateMany({
        where: { userId, isRevoked: false },
        data: { isRevoked: true },
      }),
      this.prisma.userDevice.updateMany({
        where: { userId },
        data: { isActive: false },
      }),
      this.prisma.userProfile.updateMany({
        where: { userId },
        data: { isOnline: false, lastSeen: new Date() },
      }),
    ]);

    return { deleted: true };
  }

  async changeNumber(userId: string, dto: ChangeNumberDto) {
    if (dto.otp_code) {
      const isValid = await this.otpService.verifyOtp(dto.new_phone_number, dto.otp_code);
      if (!isValid) {
        throw new UnauthorizedException('Invalid OTP code for new phone number');
      }
    }

    const existing = await this.prisma.user.findUnique({
      where: { phoneNumber: dto.new_phone_number },
    });

    if (existing && existing.id !== userId) {
      throw new ConflictException('Phone number is already associated with another account');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        phoneNumber: dto.new_phone_number,
        countryCode: dto.new_country_code,
        isVerified: true,
      },
      select: SAFE_USER_SELECT,
    });

    return updated;
  }

  async searchUsers(currentUserId: string, dto: SearchUsersDto) {
    const query = dto.q.trim();

    const blockedRelations = await this.prisma.blockedUser.findMany({
      where: {
        OR: [{ blockerId: currentUserId }, { blockedId: currentUserId }],
      },
      select: { blockerId: true, blockedId: true },
    });

    const excludedIds = new Set<string>([currentUserId]);
    for (const rel of blockedRelations) {
      excludedIds.add(rel.blockerId === currentUserId ? rel.blockedId : rel.blockerId);
    }

    const whereFilter =
      dto.type === UserSearchType.PHONE
        ? { phoneNumber: { contains: query, mode: 'insensitive' as const } }
        : dto.type === UserSearchType.USERNAME
          ? { username: { contains: query, mode: 'insensitive' as const } }
          : {
              OR: [
                { phoneNumber: { contains: query, mode: 'insensitive' as const } },
                { username: { contains: query, mode: 'insensitive' as const } },
                { displayName: { contains: query, mode: 'insensitive' as const } },
              ],
            };

    return this.prisma.user.findMany({
      where: {
        id: { notIn: Array.from(excludedIds) },
        isActive: true,
        isBanned: false,
        deletedAt: null,
        ...whereFilter,
      },
      select: {
        id: true,
        phoneNumber: true,
        countryCode: true,
        username: true,
        displayName: true,
        about: true,
        avatarUrl: true,
        profile: {
          select: {
            isOnline: true,
            lastSeen: true,
          },
        },
      },
      take: 30,
      orderBy: { displayName: 'asc' },
    });
  }

  async getUserProfile(viewerId: string, targetUserId: string) {
    const target = await this.prisma.user.findFirst({
      where: {
        id: targetUserId,
        deletedAt: null,
      },
      select: {
        ...SAFE_USER_SELECT,
        profile: true,
        privacySettings: true,
      },
    });

    if (!target) {
      throw new NotFoundException('User not found');
    }

    if (viewerId === targetUserId) {
      return target;
    }

    const [blockRecord, isContactRecord] = await Promise.all([
      this.prisma.blockedUser.findFirst({
        where: {
          OR: [
            { blockerId: targetUserId, blockedId: viewerId },
            { blockerId: viewerId, blockedId: targetUserId },
          ],
        },
      }),
      this.prisma.contact.findUnique({
        where: {
          ownerId_contactId: {
            ownerId: targetUserId,
            contactId: viewerId,
          },
        },
      }),
    ]);

    const isBlockedByTarget = blockRecord?.blockerId === targetUserId;
    const isContact = Boolean(isContactRecord);
    const privacy = target.privacySettings;

    const canSee = (scope?: VisibilityScope) => {
      if (isBlockedByTarget) return false;
      if (!scope || scope === VisibilityScope.ALL) return true;
      if (scope === VisibilityScope.CONTACTS) return isContact;
      return false;
    };

    return {
      id: target.id,
      phoneNumber: target.phoneNumber,
      countryCode: target.countryCode,
      username: target.username,
      displayName: target.displayName,
      about: canSee(privacy?.aboutVisibility) ? target.about : null,
      avatarUrl: canSee(privacy?.profilePhotoVisibility) ? target.avatarUrl : null,
      isVerified: target.isVerified,
      isBlocked: Boolean(blockRecord && blockRecord.blockerId === viewerId),
      profile: target.profile
        ? {
            isOnline: canSee(privacy?.onlineVisibility) ? target.profile.isOnline : false,
            lastSeen: canSee(privacy?.lastSeenVisibility) ? target.profile.lastSeen : null,
          }
        : null,
    };
  }

  async blockUser(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) {
      throw new BadRequestException('You cannot block yourself');
    }

    const target = await this.prisma.user.findFirst({
      where: { id: blockedId, deletedAt: null },
    });

    if (!target) {
      throw new NotFoundException('Target user not found');
    }

    const record = await this.prisma.blockedUser.upsert({
      where: {
        blockerId_blockedId: {
          blockerId,
          blockedId,
        },
      },
      create: {
        blockerId,
        blockedId,
      },
      update: {},
    });

    return record;
  }

  async unblockUser(blockerId: string, blockedId: string) {
    const existing = await this.prisma.blockedUser.findUnique({
      where: {
        blockerId_blockedId: {
          blockerId,
          blockedId,
        },
      },
    });

    if (!existing) {
      throw new NotFoundException('User is not blocked');
    }

    await this.prisma.blockedUser.delete({
      where: { id: existing.id },
    });

    return { unblocked: true, blocked_id: blockedId };
  }

  async getBlockedUsers(blockerId: string) {
    const blocked = await this.prisma.blockedUser.findMany({
      where: { blockerId },
      include: {
        blocked: {
          select: {
            id: true,
            phoneNumber: true,
            countryCode: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return blocked.map((entry) => ({
      id: entry.id,
      blockedAt: entry.createdAt,
      user: entry.blocked,
    }));
  }

  async syncContacts(ownerId: string, dto: SyncContactsDto) {
    if (!dto.contacts.length) {
      return [];
    }

    const phoneMap = new Map<string, string | undefined>();
    for (const item of dto.contacts) {
      phoneMap.set(item.phone_number, item.nickname);
    }

    const matchedUsers = await this.prisma.user.findMany({
      where: {
        phoneNumber: { in: Array.from(phoneMap.keys()) },
        id: { not: ownerId },
        isActive: true,
        isBanned: false,
        deletedAt: null,
      },
      select: {
        id: true,
        phoneNumber: true,
        countryCode: true,
        username: true,
        displayName: true,
        about: true,
        avatarUrl: true,
        profile: {
          select: {
            isOnline: true,
            lastSeen: true,
          },
        },
      },
    });

    if (!matchedUsers.length) {
      return [];
    }

    const upsertedContacts = await this.prisma.$transaction(
      matchedUsers.map((matchedUser) => {
        const nickname = phoneMap.get(matchedUser.phoneNumber);
        return this.prisma.contact.upsert({
          where: {
            ownerId_contactId: {
              ownerId,
              contactId: matchedUser.id,
            },
          },
          create: {
            ownerId,
            contactId: matchedUser.id,
            nickname: nickname || matchedUser.displayName,
          },
          update: {
            ...(nickname ? { nickname } : {}),
          },
          include: CONTACT_USER_INCLUDE,
        });
      }),
    );

    return upsertedContacts;
  }

  async addContact(ownerId: string, dto: AddContactDto) {
    const targetUser = await this.prisma.user.findFirst({
      where: {
        phoneNumber: dto.phone_number,
        id: { not: ownerId },
        isActive: true,
        isBanned: false,
        deletedAt: null,
      },
      select: {
        id: true,
        displayName: true,
      },
    });

    if (!targetUser) {
      throw new NotFoundException(
        `No registered WhatsApp Pro user found with phone number ${dto.phone_number}`,
      );
    }

    const trimmedNickname = dto.nickname?.trim();

    return this.prisma.contact.upsert({
      where: {
        ownerId_contactId: {
          ownerId,
          contactId: targetUser.id,
        },
      },
      create: {
        ownerId,
        contactId: targetUser.id,
        nickname: trimmedNickname || targetUser.displayName,
      },
      update: {
        ...(trimmedNickname ? { nickname: trimmedNickname } : {}),
      },
      include: CONTACT_USER_INCLUDE,
    });
  }

  async removeContact(ownerId: string, contactId: string) {
    const result = await this.prisma.contact.deleteMany({
      where: {
        ownerId,
        OR: [{ contactId }, { id: contactId }],
      },
    });

    if (result.count === 0) {
      throw new NotFoundException('Contact not found');
    }

    return { removed: true, contact_id: contactId };
  }

  async getContacts(ownerId: string) {
    return this.prisma.contact.findMany({
      where: {
        ownerId,
        contactUser: {
          isActive: true,
          isBanned: false,
          deletedAt: null,
        },
      },
      include: CONTACT_USER_INCLUDE,
      orderBy: [{ isFavorite: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async getDevices(userId: string) {
    return this.prisma.userDevice.findMany({
      where: { userId, isActive: true },
      orderBy: { lastActiveAt: 'desc' },
    });
  }

  async revokeDevice(userId: string, deviceId: string) {
    const device = await this.prisma.userDevice.findFirst({
      where: {
        userId,
        OR: [{ id: deviceId }, { deviceId }],
      },
    });

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    await this.prisma.$transaction([
      this.prisma.userDevice.update({
        where: { id: device.id },
        data: { isActive: false },
      }),
      this.prisma.authenticationSession.updateMany({
        where: {
          userId,
          deviceId: device.deviceId,
          isRevoked: false,
        },
        data: { isRevoked: true },
      }),
    ]);

    return { revoked: true, device_id: device.deviceId };
  }
}

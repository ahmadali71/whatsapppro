import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SearchQueryDto, SearchType } from './dto/search-query.dto';

export interface SearchDateRange {
  dateFrom?: Date;
  dateTo?: Date;
}

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async globalSearch(
    userId: string,
    query: string,
    type: SearchType = 'all',
    filters: Omit<SearchQueryDto, 'q' | 'type'> = {},
  ) {
    const trimmed = (query ?? '').trim();
    const limit = Math.min(filters.limit ?? 20, 100);
    const offset = filters.offset ?? 0;
    const dateRange: SearchDateRange = {
      dateFrom: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
      dateTo: filters.dateTo ? new Date(filters.dateTo) : undefined,
    };

    if (!trimmed) {
      return {
        contacts: [],
        messages: [],
        groups: [],
        media: [],
      };
    }

    if (type === 'contacts') {
      const contacts = await this.searchContacts(userId, trimmed, limit, offset);
      return { contacts };
    }
    if (type === 'messages') {
      const messages = await this.searchMessages(
        userId,
        trimmed,
        filters.conversationId,
        dateRange,
        limit,
        offset,
      );
      return { messages };
    }
    if (type === 'groups') {
      const groups = await this.searchGroups(userId, trimmed, limit, offset);
      return { groups };
    }
    if (type === 'media') {
      const media = await this.searchMedia(
        userId,
        trimmed,
        filters.mediaType,
        filters.conversationId,
        dateRange,
        limit,
        offset,
      );
      return { media };
    }

    const [contacts, messages, groups, media] = await Promise.all([
      this.searchContacts(userId, trimmed, limit, offset),
      this.searchMessages(
        userId,
        trimmed,
        filters.conversationId,
        dateRange,
        limit,
        offset,
      ),
      this.searchGroups(userId, trimmed, limit, offset),
      this.searchMedia(
        userId,
        trimmed,
        filters.mediaType,
        filters.conversationId,
        dateRange,
        limit,
        offset,
      ),
    ]);

    return {
      contacts,
      messages,
      groups,
      media,
    };
  }

  async searchMessages(
    userId: string,
    query: string,
    conversationId?: string,
    dateRange?: SearchDateRange,
    limit = 20,
    offset = 0,
  ) {
    const createdAtFilter: any = {};
    if (dateRange?.dateFrom) createdAtFilter.gte = dateRange.dateFrom;
    if (dateRange?.dateTo) createdAtFilter.lte = dateRange.dateTo;

    return this.prisma.message.findMany({
      where: {
        isDeletedForEveryone: false,
        content: {
          contains: query,
          mode: 'insensitive',
        },
        ...(conversationId ? { conversationId } : {}),
        ...(Object.keys(createdAtFilter).length > 0 ? { createdAt: createdAtFilter } : {}),
        conversation: {
          members: {
            some: {
              userId,
              isActive: true,
              leftAt: null,
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        sender: {
          select: {
            id: true,
            displayName: true,
            username: true,
            avatarUrl: true,
          },
        },
        conversation: {
          select: {
            id: true,
            type: true,
            group: {
              select: {
                id: true,
                name: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });
  }

  async searchContacts(userId: string, query: string, limit = 20, offset = 0) {
    const blockedRelations = await this.prisma.blockedUser.findMany({
      where: {
        OR: [{ blockerId: userId }, { blockedId: userId }],
      },
      select: { blockerId: true, blockedId: true },
    });

    const blockedIds = blockedRelations.map((r) =>
      r.blockerId === userId ? r.blockedId : r.blockerId,
    );

    const savedContacts = await this.prisma.contact.findMany({
      where: {
        ownerId: userId,
        contactId: { notIn: blockedIds },
        OR: [
          { nickname: { contains: query, mode: 'insensitive' } },
          {
            contactUser: {
              OR: [
                { displayName: { contains: query, mode: 'insensitive' } },
                { username: { contains: query, mode: 'insensitive' } },
                { phoneNumber: { contains: query, mode: 'insensitive' } },
              ],
            },
          },
        ],
      },
      take: limit,
      skip: offset,
      include: {
        contactUser: {
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
    });

    return savedContacts;
  }

  async searchGroups(userId: string, query: string, limit = 20, offset = 0) {
    return this.prisma.group.findMany({
      where: {
        deletedAt: null,
        members: {
          some: {
            userId,
            isActive: true,
          },
        },
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        _count: {
          select: { members: true },
        },
        conversations: {
          select: { id: true },
          take: 1,
        },
      },
    });
  }

  async searchMedia(
    userId: string,
    query: string,
    mediaType?: string,
    conversationId?: string,
    dateRange?: SearchDateRange,
    limit = 20,
    offset = 0,
  ) {
    const createdAtFilter: any = {};
    if (dateRange?.dateFrom) createdAtFilter.gte = dateRange.dateFrom;
    if (dateRange?.dateTo) createdAtFilter.lte = dateRange.dateTo;

    return this.prisma.messageAttachment.findMany({
      where: {
        ...(mediaType ? { fileType: { equals: mediaType, mode: 'insensitive' } } : {}),
        ...(Object.keys(createdAtFilter).length > 0 ? { createdAt: createdAtFilter } : {}),
        OR: [
          { fileName: { contains: query, mode: 'insensitive' } },
          { mimeType: { contains: query, mode: 'insensitive' } },
          { fileType: { contains: query, mode: 'insensitive' } },
        ],
        message: {
          isDeletedForEveryone: false,
          ...(conversationId ? { conversationId } : {}),
          conversation: {
            members: {
              some: {
                userId,
                isActive: true,
                leftAt: null,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        message: {
          select: {
            id: true,
            conversationId: true,
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
  }
}

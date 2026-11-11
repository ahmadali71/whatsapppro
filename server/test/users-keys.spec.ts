import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { VisibilityScope } from '@prisma/client';
import { UsersController } from '../src/users/users.controller';
import { UsersService } from '../src/users/users.service';
import { UserSearchType } from '../src/users/dto/search-users.dto';
import { KeysController } from '../src/keys/keys.controller';
import { KeysService } from '../src/keys/keys.service';
import { OtpService } from '../src/otp/otp.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Users, Contacts, Privacy, Blocking & E2EE Keys Suite', () => {
  let usersController: UsersController;
  let usersService: UsersService;
  let keysController: KeysController;
  let keysService: KeysService;

  const mockPrismaService: any = {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    blockedUser: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    contact: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    userKeyBundle: {
      upsert: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(async (arg: any) => {
      if (typeof arg === 'function') {
        return arg(mockPrismaService);
      }
      return Promise.all(arg);
    }),
  };

  const mockOtpService = {
    verifyOtp: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController, KeysController],
      providers: [
        UsersService,
        KeysService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: OtpService, useValue: mockOtpService },
      ],
    }).compile();

    usersController = module.get<UsersController>(UsersController);
    usersService = module.get<UsersService>(UsersService);
    keysController = module.get<KeysController>(KeysController);
    keysService = module.get<KeysService>(KeysService);
  });

  describe('User search & contact sync', () => {
    it('excludes self and blocked users from search results', async () => {
      mockPrismaService.blockedUser.findMany.mockResolvedValue([
        { blockerId: 'u1', blockedId: 'u-blocked' },
      ]);
      mockPrismaService.user.findMany.mockResolvedValue([
        { id: 'u2', displayName: 'Bob', username: 'bob_pro', phoneNumber: '+15550100002' },
      ]);

      const res = await usersController.searchUsers('u1', {
        q: 'bob',
        type: UserSearchType.USERNAME,
      });

      expect(res.success).toBe(true);
      expect(res.data).toHaveLength(1);
      expect(mockPrismaService.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { notIn: ['u1', 'u-blocked'] },
          }),
        }),
      );
    });

    it('syncs matched phone numbers into contacts transactionally', async () => {
      mockPrismaService.user.findMany.mockResolvedValue([
        { id: 'u2', phoneNumber: '+15550100002', displayName: 'Bob' },
      ]);
      mockPrismaService.contact.upsert.mockResolvedValue({
        id: 'contact-1',
        ownerId: 'u1',
        contactId: 'u2',
        nickname: 'Bob Work',
      });

      const res = await usersController.syncContacts('u1', {
        contacts: [
          { phone_number: '+15550100002', nickname: 'Bob Work' },
          { phone_number: '+15550999999', nickname: 'Unregistered' },
        ],
      });

      expect(res.success).toBe(true);
      expect(res.data).toHaveLength(1);
      expect(mockPrismaService.contact.upsert).toHaveBeenCalledTimes(1);
    });

    it('adds a single registered contact by phone number and throws 404 when unregistered', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'u2',
        displayName: 'Bob Smith',
      });
      mockPrismaService.contact.upsert.mockResolvedValue({
        id: 'contact-2',
        ownerId: 'u1',
        contactId: 'u2',
        nickname: 'Bobby',
        contactUser: {
          id: 'u2',
          phoneNumber: '+15550100002',
          displayName: 'Bob Smith',
        },
      });

      const added = await usersController.addContact('u1', {
        phone_number: '+15550100002',
        nickname: '  Bobby  ',
      });

      expect(added.success).toBe(true);
      expect(added.data.nickname).toBe('Bobby');
      expect(mockPrismaService.contact.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            ownerId: 'u1',
            contactId: 'u2',
            nickname: 'Bobby',
          }),
        }),
      );

      mockPrismaService.user.findFirst.mockResolvedValue(null);
      await expect(
        usersController.addContact('u1', { phone_number: '+15550999999' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('removes a saved contact by contactId or record id and throws 404 if missing', async () => {
      mockPrismaService.contact.deleteMany.mockResolvedValue({ count: 1 });

      const removed = await usersController.removeContact('u1', 'u2');
      expect(removed.success).toBe(true);
      expect(removed.data).toEqual({ removed: true, contact_id: 'u2' });
      expect(mockPrismaService.contact.deleteMany).toHaveBeenCalledWith({
        where: {
          ownerId: 'u1',
          OR: [{ contactId: 'u2' }, { id: 'u2' }],
        },
      });

      mockPrismaService.contact.deleteMany.mockResolvedValue({ count: 0 });
      await expect(usersController.removeContact('u1', 'missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('Blocking & privacy visibility enforcement', () => {
    it('prevents blocking self and supports block/unblock lifecycle', async () => {
      await expect(usersService.blockUser('u1', 'u1')).rejects.toThrow(BadRequestException);

      mockPrismaService.user.findFirst.mockResolvedValue({ id: 'u2' });
      mockPrismaService.blockedUser.upsert.mockResolvedValue({
        id: 'blk-1',
        blockerId: 'u1',
        blockedId: 'u2',
      });
      const blocked = await usersService.blockUser('u1', 'u2');
      expect(blocked.blockedId).toBe('u2');

      mockPrismaService.blockedUser.findUnique.mockResolvedValue({ id: 'blk-1' });
      const unblocked = await usersService.unblockUser('u1', 'u2');
      expect(unblocked.unblocked).toBe(true);
    });

    it('enforces CONTACTS and NOBODY privacy visibility and hides fields when blocked by target', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'u2',
        phoneNumber: '+15550100002',
        countryCode: '+1',
        username: 'bob',
        displayName: 'Bob',
        about: 'Secret Bio',
        avatarUrl: 'https://cdn/bob.jpg',
        isVerified: true,
        profile: { isOnline: true, lastSeen: new Date('2026-11-11T00:00:00Z') },
        privacySettings: {
          aboutVisibility: VisibilityScope.CONTACTS,
          profilePhotoVisibility: VisibilityScope.NOBODY,
          onlineVisibility: VisibilityScope.ALL,
          lastSeenVisibility: VisibilityScope.CONTACTS,
        },
      });

      // Non-contact viewer
      mockPrismaService.blockedUser.findFirst.mockResolvedValue(null);
      mockPrismaService.contact.findUnique.mockResolvedValue(null);

      const nonContactProfile = await usersService.getUserProfile('u1', 'u2');
      expect(nonContactProfile.about).toBeNull();
      expect(nonContactProfile.avatarUrl).toBeNull();
      expect(nonContactProfile.profile?.isOnline).toBe(true);
      expect(nonContactProfile.profile?.lastSeen).toBeNull();

      // Blocked by target overrides ALL visibility too
      mockPrismaService.blockedUser.findFirst.mockResolvedValue({
        blockerId: 'u2',
        blockedId: 'u1',
      });
      const blockedProfile = await usersService.getUserProfile('u1', 'u2');
      expect(blockedProfile.about).toBeNull();
      expect(blockedProfile.avatarUrl).toBeNull();
      expect(blockedProfile.profile?.isOnline).toBe(false);
      expect(blockedProfile.profile?.lastSeen).toBeNull();
    });
  });

  describe('E2EE Key Bundle upload & atomic one-time pre-key consumption', () => {
    it('uploads a Signal key bundle and atomically pops one-time pre-keys on each fetch', async () => {
      mockPrismaService.userKeyBundle.upsert.mockResolvedValue({
        id: 'bundle-1',
        userId: 'u2',
        deviceId: 'dev-1',
        registrationId: 12345,
        updatedAt: new Date(),
      });

      const uploadRes = await keysController.uploadBundle('u2', {
        deviceId: 'dev-1',
        registrationId: 12345,
        identityKey: 'id-key-b64',
        signedPreKeyId: 1,
        signedPreKey: 'spk-b64',
        signedPreKeySignature: 'sig-b64',
        oneTimePreKeys: [
          { keyId: 10, publicKey: 'otpk-10' },
          { keyId: 11, publicKey: 'otpk-11' },
        ],
      });

      expect(uploadRes.success).toBe(true);
      expect(uploadRes.data.oneTimePreKeysCount).toBe(2);

      let currentPreKeys = [
        { keyId: 10, publicKey: 'otpk-10' },
        { keyId: 11, publicKey: 'otpk-11' },
      ];

      mockPrismaService.userKeyBundle.findFirst.mockImplementation(async () => ({
        id: 'bundle-1',
        userId: 'u2',
        deviceId: 'dev-1',
        registrationId: 12345,
        identityKey: 'id-key-b64',
        signedPreKeyId: 1,
        signedPreKey: 'spk-b64',
        signedPreKeySignature: 'sig-b64',
        oneTimePreKeys: currentPreKeys,
      }));
      mockPrismaService.userKeyBundle.update.mockImplementation(async ({ data }: any) => {
        currentPreKeys = data.oneTimePreKeys;
        return {};
      });

      const firstFetch = await keysService.consumeKeyBundle('u2', 'dev-1');
      expect(firstFetch.oneTimePreKey).toEqual({ keyId: 10, publicKey: 'otpk-10' });
      expect(firstFetch.remainingOneTimePreKeys).toBe(1);

      const secondFetch = await keysService.consumeKeyBundle('u2', 'dev-1');
      expect(secondFetch.oneTimePreKey).toEqual({ keyId: 11, publicKey: 'otpk-11' });
      expect(secondFetch.remainingOneTimePreKeys).toBe(0);

      const thirdFetch = await keysService.consumeKeyBundle('u2', 'dev-1');
      expect(thirdFetch.oneTimePreKey).toBeNull();
      expect(thirdFetch.remainingOneTimePreKeys).toBe(0);
    });

    it('throws NotFoundException when target user has no uploaded key bundle', async () => {
      mockPrismaService.userKeyBundle.findFirst.mockResolvedValue(null);
      await expect(keysService.consumeKeyBundle('missing-user')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

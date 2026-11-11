import { PrismaClient, UserRole, ConversationType, MemberRole, MessageType, ReceiptStatus, StatusContentType, StatusPrivacy } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding WhatsApp Pro database...');

  // Clean existing seed records safely (in reverse dependency order)
  await prisma.systemConfig.deleteMany();
  await prisma.userKeyBundle.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.report.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.callParticipant.deleteMany();
  await prisma.call.deleteMany();
  await prisma.statusReaction.deleteMany();
  await prisma.statusView.deleteMany();
  await prisma.status.deleteMany();
  await prisma.communityMember.deleteMany();
  await prisma.community.deleteMany();
  await prisma.groupInvite.deleteMany();
  await prisma.groupMember.deleteMany();
  await prisma.starredMessage.deleteMany();
  await prisma.messageEdit.deleteMany();
  await prisma.messageAttachment.deleteMany();
  await prisma.messageReaction.deleteMany();
  await prisma.messageReceipt.deleteMany();
  await prisma.message.deleteMany();
  await prisma.archivedChat.deleteMany();
  await prisma.conversationMember.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.group.deleteMany();
  await prisma.blockedUser.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.authenticationSession.deleteMany();
  await prisma.userDevice.deleteMany();
  await prisma.userProfile.deleteMany();
  await prisma.privacySetting.deleteMany();
  await prisma.chatSetting.deleteMany();
  await prisma.user.deleteMany();

  // 1. Create Users (including Admin)
  const admin = await prisma.user.create({
    data: {
      phoneNumber: '+15550100000',
      countryCode: '+1',
      username: 'admin_pro',
      displayName: 'WhatsApp Pro Admin',
      about: 'System Administrator',
      role: UserRole.ADMIN,
      isVerified: true,
      profile: {
        create: {
          isOnline: true,
          lastSeen: new Date(),
          platform: 'WEB',
          appVersion: '1.0.0',
        },
      },
      privacySettings: { create: {} },
      chatSettings: { create: {} },
    },
  });

  const alice = await prisma.user.create({
    data: {
      phoneNumber: '+15550100001',
      countryCode: '+1',
      username: 'alice_pro',
      displayName: 'Alice Johnson',
      about: 'Building the future of messaging 🚀',
      avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alice',
      isVerified: true,
      profile: {
        create: {
          isOnline: true,
          lastSeen: new Date(),
          platform: 'WEB',
          appVersion: '1.0.0',
        },
      },
      privacySettings: { create: {} },
      chatSettings: { create: {} },
    },
  });

  const bob = await prisma.user.create({
    data: {
      phoneNumber: '+15550100002',
      countryCode: '+1',
      username: 'bob_smith',
      displayName: 'Bob Smith',
      about: 'Available for coffee ☕',
      avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Bob',
      isVerified: true,
      profile: {
        create: {
          isOnline: false,
          lastSeen: new Date(Date.now() - 1000 * 60 * 15),
          platform: 'IOS',
          appVersion: '1.0.0',
        },
      },
      privacySettings: { create: {} },
      chatSettings: { create: {} },
    },
  });

  const charlie = await prisma.user.create({
    data: {
      phoneNumber: '+15550100003',
      countryCode: '+1',
      username: 'charlie_dev',
      displayName: 'Charlie Rivera',
      about: 'Busy coding...',
      avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Charlie',
      isVerified: true,
      profile: {
        create: {
          isOnline: true,
          lastSeen: new Date(),
          platform: 'ANDROID',
          appVersion: '1.0.0',
        },
      },
      privacySettings: { create: {} },
      chatSettings: { create: {} },
    },
  });

  // 2. Create Contacts
  await prisma.contact.createMany({
    data: [
      { ownerId: alice.id, contactId: bob.id, nickname: 'Bob (Work)', isFavorite: true },
      { ownerId: alice.id, contactId: charlie.id, nickname: 'Charlie', isFavorite: false },
      { ownerId: bob.id, contactId: alice.id, nickname: 'Alice', isFavorite: true },
      { ownerId: charlie.id, contactId: alice.id, nickname: 'Alice', isFavorite: false },
    ],
  });

  // 3. Create Direct Conversation (Alice <-> Bob)
  const directConversation = await prisma.conversation.create({
    data: {
      type: ConversationType.DIRECT,
      createdBy: alice.id,
      members: {
        create: [
          { userId: alice.id, role: MemberRole.MEMBER },
          { userId: bob.id, role: MemberRole.MEMBER },
        ],
      },
    },
  });

  const msg1 = await prisma.message.create({
    data: {
      conversationId: directConversation.id,
      senderId: alice.id,
      content: 'Hey Bob! Welcome to WhatsApp Pro 👋',
      messageType: MessageType.TEXT,
      deliveredAt: new Date(),
      readAt: new Date(),
      receipts: {
        create: {
          userId: bob.id,
          status: ReceiptStatus.READ,
        },
      },
    },
  });

  await prisma.message.create({
    data: {
      conversationId: directConversation.id,
      senderId: bob.id,
      content: 'Thanks Alice! Everything looks super clean and fast.',
      messageType: MessageType.TEXT,
      replyToId: msg1.id,
      deliveredAt: new Date(),
      receipts: {
        create: {
          userId: alice.id,
          status: ReceiptStatus.DELIVERED,
        },
      },
      reactions: {
        create: {
          userId: alice.id,
          emoji: '❤️',
        },
      },
    },
  });

  // 4. Create Group + Group Conversation
  const engineeringGroup = await prisma.group.create({
    data: {
      name: 'WhatsApp Pro Engineering',
      description: 'Core architecture & real-time systems discussion',
      inviteLink: 'whatsapp-pro-eng-2026',
      createdBy: alice.id,
      members: {
        create: [
          { userId: alice.id, role: MemberRole.OWNER },
          { userId: bob.id, role: MemberRole.ADMIN, addedBy: alice.id },
          { userId: charlie.id, role: MemberRole.MEMBER, addedBy: alice.id },
        ],
      },
      invites: {
        create: {
          inviteCode: 'ENGPRO2026',
          createdBy: alice.id,
          maxUses: 50,
        },
      },
    },
  });

  const groupConversation = await prisma.conversation.create({
    data: {
      type: ConversationType.GROUP,
      createdBy: alice.id,
      groupId: engineeringGroup.id,
      members: {
        create: [
          { userId: alice.id, role: MemberRole.OWNER },
          { userId: bob.id, role: MemberRole.ADMIN },
          { userId: charlie.id, role: MemberRole.MEMBER },
        ],
      },
    },
  });

  await prisma.message.create({
    data: {
      conversationId: groupConversation.id,
      senderId: alice.id,
      content: 'Team, monorepo scaffolding and database schema are live!',
      messageType: MessageType.TEXT,
    },
  });

  // 5. Create Status Update
  await prisma.status.create({
    data: {
      userId: alice.id,
      contentType: StatusContentType.TEXT,
      textContent: 'Shipping WhatsApp Pro v1.0 today! 🎉',
      backgroundColor: '#075E54',
      fontStyle: 'sans-serif',
      privacy: StatusPrivacy.CONTACTS,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
      views: {
        create: { viewerId: bob.id },
      },
      reactions: {
        create: { userId: bob.id, emoji: '🔥' },
      },
    },
  });

  // 6. Seed Default System Config
  await prisma.systemConfig.create({
    data: {
      key: 'app_settings',
      value: {
        maxFileUploadSizeMb: 50,
        maxGroupSize: 1024,
        registrationEnabled: true,
        maintenanceMode: false,
      },
      updatedBy: admin.id,
    },
  });

  console.log('✅ Seed completed successfully!');
}

main()
  .catch((error) => {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OneTimePreKeyDto, UploadKeyBundleDto } from './dto/upload-key-bundle.dto';

@Injectable()
export class KeysService {
  constructor(private readonly prisma: PrismaService) {}

  async uploadKeyBundle(userId: string, dto: UploadKeyBundleDto) {
    const deviceId = dto.deviceId || 'default';
    const oneTimePreKeysJson = dto.oneTimePreKeys.map((k) => ({
      keyId: k.keyId,
      publicKey: k.publicKey,
    })) as unknown as Prisma.InputJsonValue;

    const bundle = await this.prisma.userKeyBundle.upsert({
      where: {
        userId_deviceId: {
          userId,
          deviceId,
        },
      },
      create: {
        userId,
        deviceId,
        registrationId: dto.registrationId,
        identityKey: dto.identityKey,
        signedPreKeyId: dto.signedPreKeyId,
        signedPreKey: dto.signedPreKey,
        signedPreKeySignature: dto.signedPreKeySignature,
        oneTimePreKeys: oneTimePreKeysJson,
      },
      update: {
        registrationId: dto.registrationId,
        identityKey: dto.identityKey,
        signedPreKeyId: dto.signedPreKeyId,
        signedPreKey: dto.signedPreKey,
        signedPreKeySignature: dto.signedPreKeySignature,
        oneTimePreKeys: oneTimePreKeysJson,
      },
    });

    return {
      id: bundle.id,
      userId: bundle.userId,
      deviceId: bundle.deviceId,
      registrationId: bundle.registrationId,
      oneTimePreKeysCount: dto.oneTimePreKeys.length,
      updatedAt: bundle.updatedAt,
    };
  }

  async consumeKeyBundle(targetUserId: string, deviceId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const bundle = await tx.userKeyBundle.findFirst({
        where: {
          userId: targetUserId,
          ...(deviceId ? { deviceId } : {}),
        },
        orderBy: { updatedAt: 'desc' },
      });

      if (!bundle) {
        throw new NotFoundException('E2EE key bundle not found for this user');
      }

      const preKeys = Array.isArray(bundle.oneTimePreKeys)
        ? (bundle.oneTimePreKeys as unknown as OneTimePreKeyDto[])
        : [];

      const [consumedPreKey, ...remainingPreKeys] = preKeys;

      if (consumedPreKey) {
        await tx.userKeyBundle.update({
          where: { id: bundle.id },
          data: {
            oneTimePreKeys: remainingPreKeys as unknown as Prisma.InputJsonValue,
          },
        });
      }

      return {
        userId: bundle.userId,
        deviceId: bundle.deviceId,
        registrationId: bundle.registrationId,
        identityKey: bundle.identityKey,
        signedPreKey: {
          keyId: bundle.signedPreKeyId,
          publicKey: bundle.signedPreKey,
          signature: bundle.signedPreKeySignature,
        },
        oneTimePreKey: consumedPreKey || null,
        remainingOneTimePreKeys: remainingPreKeys.length,
      };
    });
  }
}

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { OtpService } from '../otp/otp.service';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { SendOtpDto } from './dto/send-otp.dto';
import { LoginDto, VerifyOtpDto } from './dto/verify-otp.dto';
import { EnableTwoFactorDto, VerifyTwoFactorDto } from './dto/two-factor.dto';

const BCRYPT_ROUNDS = 12;
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '30d';
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly otpService: OtpService,
  ) {}

  generateOtp(): string {
    return this.otpService.generateOtp();
  }

  async sendOtpViaTwilio(phoneNumber: string, otp: string): Promise<void> {
    return this.otpService.sendOtpViaTwilio(phoneNumber, otp);
  }

  async verifyOtp(phoneNumber: string, otpCode: string): Promise<boolean> {
    return this.otpService.verifyOtp(phoneNumber, otpCode);
  }

  async hashPassword(value: string): Promise<string> {
    return bcrypt.hash(value, BCRYPT_ROUNDS);
  }

  async compareHash(value: string, hash: string): Promise<boolean> {
    return bcrypt.compare(value, hash);
  }

  sanitizeUser(user: User) {
    const { twoFactorPinHash: _pinHash, ...safeUser } = user;
    return safeUser;
  }

  async generateJwtTokens(user: Pick<User, 'id' | 'phoneNumber' | 'role'>) {
    const accessSecret = this.configService.get<string>(
      'JWT_SECRET',
      'whatsapp-pro-dev-jwt-secret',
    );
    const refreshSecret = this.configService.get<string>(
      'JWT_REFRESH_SECRET',
      'whatsapp-pro-dev-refresh-secret',
    );

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        {
          sub: user.id,
          phoneNumber: user.phoneNumber,
          role: user.role,
          type: 'access',
        },
        {
          secret: accessSecret,
          expiresIn: ACCESS_TOKEN_EXPIRY,
        },
      ),
      this.jwtService.signAsync(
        {
          sub: user.id,
          phoneNumber: user.phoneNumber,
          role: user.role,
          type: 'refresh',
          jti: randomUUID(),
        },
        {
          secret: refreshSecret,
          expiresIn: REFRESH_TOKEN_EXPIRY,
        },
      ),
    ]);

    return {
      accessToken,
      refreshToken,
      expiresIn: 900,
    };
  }

  async validateUser(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        deletedAt: null,
      },
      include: {
        profile: true,
      },
    });

    if (!user || !user.isActive || user.isBanned) {
      return null;
    }

    return this.sanitizeUser(user);
  }

  private ensureDatabaseConnected(): void {
    const status = (
      this.prisma as unknown as {
        getStatus?: () => { connected: boolean; error?: string | null };
      }
    ).getStatus?.();

    if (status && !status.connected) {
      throw new ServiceUnavailableException(
        'Database is not connected. Configure DATABASE_URL in your deployment environment variables.',
      );
    }
  }

  private async executeWithDbGuard<T>(operation: () => Promise<T>): Promise<T> {
    this.ensureDatabaseConnected();
    try {
      return await operation();
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      const name = error instanceof Error ? error.name : '';
      if (
        name === 'PrismaClientInitializationError' ||
        /Can't reach database server|ECONNREFUSED|ETIMEDOUT|Connection terminated|Environment variable not found: DATABASE_URL/i.test(
          message,
        )
      ) {
        throw new ServiceUnavailableException(
          'Database is not connected. Configure DATABASE_URL in your deployment environment variables.',
        );
      }
      throw error;
    }
  }

  async register(dto: RegisterDto) {
    return this.executeWithDbGuard(async () => {
      const existingByPhone = await this.prisma.user.findUnique({
        where: { phoneNumber: dto.phone },
      });

      if (existingByPhone && !existingByPhone.deletedAt && existingByPhone.isVerified) {
        throw new ConflictException('A verified account with this phone number already exists');
      }

      if (dto.username) {
        const existingByUsername = await this.prisma.user.findUnique({
          where: { username: dto.username },
        });
        if (
          existingByUsername &&
          (!existingByPhone || existingByUsername.id !== existingByPhone.id)
        ) {
          throw new ConflictException('Username is already taken');
        }
      }

      const user = existingByPhone
        ? await this.prisma.user.update({
            where: { id: existingByPhone.id },
            data: {
              countryCode: dto.country_code,
              displayName: dto.display_name,
              username: dto.username ?? existingByPhone.username,
              recoveryEmail: dto.recovery_email ?? existingByPhone.recoveryEmail,
              isActive: true,
              deletedAt: null,
            },
          })
        : await this.prisma.user.create({
            data: {
              phoneNumber: dto.phone,
              countryCode: dto.country_code,
              displayName: dto.display_name,
              username: dto.username,
              recoveryEmail: dto.recovery_email,
              profile: {
                create: {
                  isOnline: false,
                  lastSeen: new Date(),
                },
              },
              privacySettings: { create: {} },
              chatSettings: { create: {} },
            },
          });

      const otpResult = await this.otpService.sendOtp(user.phoneNumber);

      return {
        user: this.sanitizeUser(user),
        otp_sent: true,
        expires_in: otpResult.expiresIn,
        ...(otpResult.devOtp ? { dev_otp: otpResult.devOtp } : {}),
      };
    });
  }

  async sendOtp(dto: SendOtpDto) {
    this.ensureDatabaseConnected();
    const otpResult = await this.otpService.sendOtp(dto.phone_number);
    return {
      phone_number: dto.phone_number,
      country_code: dto.country_code,
      expires_in: otpResult.expiresIn,
      ...(otpResult.devOtp ? { dev_otp: otpResult.devOtp } : {}),
    };
  }

  async verifyOtpAndAuthenticate(
    dto: VerifyOtpDto,
    ipAddress?: string,
    userAgent?: string,
  ) {
    return this.executeWithDbGuard(() =>
      this.authenticateWithOtp(dto, ipAddress, userAgent),
    );
  }

  async login(dto: LoginDto, ipAddress?: string, userAgent?: string) {
    return this.executeWithDbGuard(() =>
      this.authenticateWithOtp(dto, ipAddress, userAgent),
    );
  }

  private async authenticateWithOtp(
    dto: VerifyOtpDto,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const isValid = await this.verifyOtp(dto.phone_number, dto.otp_code);
    if (!isValid) {
      throw new UnauthorizedException('Invalid OTP code');
    }

    const user = await this.prisma.user.findUnique({
      where: { phoneNumber: dto.phone_number },
    });

    if (!user || user.deletedAt) {
      throw new NotFoundException('Account not found. Please register first.');
    }

    if (user.isBanned) {
      throw new ForbiddenException('This account has been suspended.');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        isVerified: true,
        isActive: true,
        profile: {
          upsert: {
            create: {
              isOnline: true,
              lastSeen: new Date(),
              platform: dto.device_info?.platform,
            },
            update: {
              isOnline: true,
              lastSeen: new Date(),
              platform: dto.device_info?.platform,
            },
          },
        },
      },
      include: {
        profile: true,
      },
    });

    const deviceId = dto.device_info?.device_id || randomUUID();
    if (dto.device_info) {
      await this.prisma.userDevice.upsert({
        where: {
          userId_deviceId: {
            userId: updatedUser.id,
            deviceId,
          },
        },
        create: {
          userId: updatedUser.id,
          deviceId,
          deviceName: dto.device_info.device_name || 'Unknown Device',
          deviceType: dto.device_info.device_type || 'WEB',
          platform: dto.device_info.platform || 'WEB',
          pushToken: dto.device_info.push_token,
          isActive: true,
          lastActiveAt: new Date(),
        },
        update: {
          deviceName: dto.device_info.device_name || 'Unknown Device',
          deviceType: dto.device_info.device_type || 'WEB',
          platform: dto.device_info.platform || 'WEB',
          pushToken: dto.device_info.push_token,
          isActive: true,
          lastActiveAt: new Date(),
        },
      });
    }

    const tokens = await this.generateJwtTokens(updatedUser);
    const refreshTokenHash = await this.hashPassword(tokens.refreshToken);

    await this.prisma.authenticationSession.create({
      data: {
        userId: updatedUser.id,
        refreshTokenHash,
        deviceId,
        ipAddress,
        userAgent,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });

    return {
      user: this.sanitizeUser(updatedUser),
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_in: tokens.expiresIn,
      requires_two_factor: updatedUser.twoFactorEnabled,
      device_id: deviceId,
    };
  }

  async logout(userId: string, refreshToken?: string, deviceId?: string) {
    const activeSessions = await this.prisma.authenticationSession.findMany({
      where: {
        userId,
        isRevoked: false,
        ...(deviceId ? { deviceId } : {}),
      },
    });

    if (refreshToken) {
      for (const session of activeSessions) {
        const matches = await this.compareHash(refreshToken, session.refreshTokenHash);
        if (matches) {
          await this.prisma.authenticationSession.update({
            where: { id: session.id },
            data: { isRevoked: true },
          });
        }
      }
    } else {
      await this.prisma.authenticationSession.updateMany({
        where: {
          userId,
          isRevoked: false,
          ...(deviceId ? { deviceId } : {}),
        },
        data: { isRevoked: true },
      });
    }

    if (deviceId) {
      await this.prisma.userDevice.updateMany({
        where: { userId, deviceId },
        data: { isActive: false },
      });
    }

    await this.prisma.userProfile.updateMany({
      where: { userId },
      data: {
        isOnline: false,
        lastSeen: new Date(),
      },
    });

    return { logged_out: true };
  }

  async refreshTokens(refreshToken: string, ipAddress?: string, userAgent?: string) {
    const refreshSecret = this.configService.get<string>(
      'JWT_REFRESH_SECRET',
      'whatsapp-pro-dev-refresh-secret',
    );

    let payload: { sub: string; type: string };
    try {
      payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (!payload?.sub || payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid refresh token payload');
    }

    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null },
    });

    if (!user || !user.isActive || user.isBanned) {
      throw new UnauthorizedException('User account is inactive or banned');
    }

    const activeSessions = await this.prisma.authenticationSession.findMany({
      where: {
        userId: user.id,
        isRevoked: false,
        expiresAt: { gt: new Date() },
      },
    });

    let matchedSessionId: string | null = null;
    let matchedDeviceId: string | null = null;

    for (const session of activeSessions) {
      const matches = await this.compareHash(refreshToken, session.refreshTokenHash);
      if (matches) {
        matchedSessionId = session.id;
        matchedDeviceId = session.deviceId;
        break;
      }
    }

    if (!matchedSessionId) {
      throw new UnauthorizedException('Refresh session revoked or expired');
    }

    const tokens = await this.generateJwtTokens(user);
    const newRefreshHash = await this.hashPassword(tokens.refreshToken);

    await this.prisma.$transaction([
      this.prisma.authenticationSession.update({
        where: { id: matchedSessionId },
        data: { isRevoked: true },
      }),
      this.prisma.authenticationSession.create({
        data: {
          userId: user.id,
          refreshTokenHash: newRefreshHash,
          deviceId: matchedDeviceId,
          ipAddress,
          userAgent,
          expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        },
      }),
    ]);

    return {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_in: tokens.expiresIn,
    };
  }

  async enable2FA(userId: string, dto: EnableTwoFactorDto) {
    const pinHash = await this.hashPassword(dto.pin);

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorPinHash: pinHash,
        ...(dto.recovery_email ? { recoveryEmail: dto.recovery_email } : {}),
      },
    });

    return {
      two_factor_enabled: updated.twoFactorEnabled,
      recovery_email: updated.recoveryEmail,
    };
  }

  async verify2FA(userId: string, dto: VerifyTwoFactorDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.twoFactorEnabled || !user.twoFactorPinHash) {
      throw new BadRequestException('Two-factor authentication is not enabled');
    }

    const isMatch = await this.compareHash(dto.pin, user.twoFactorPinHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid two-factor PIN');
    }

    return { verified: true };
  }
}

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { OtpService } from '../src/otp/otp.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';

describe('Auth & OTP Integration/Unit Suite', () => {
  let authController: AuthController;
  let authService: AuthService;
  let otpService: OtpService;

  const redisStore = new Map<string, string>();

  const mockRedisService = {
    get: jest.fn(async (key: string) => redisStore.get(key) ?? null),
    set: jest.fn(async (key: string, value: string, _ttl?: number) => {
      redisStore.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (key: string) => {
      const existed = redisStore.delete(key);
      return existed ? 1 : 0;
    }),
    incr: jest.fn(async (key: string) => {
      const next = (parseInt(redisStore.get(key) ?? '0', 10) || 0) + 1;
      redisStore.set(key, String(next));
      return next;
    }),
    expire: jest.fn(async () => 1),
    exists: jest.fn(async (key: string) => (redisStore.has(key) ? 1 : 0)),
  };

  const mockPrismaService: any = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    userDevice: {
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    userProfile: {
      updateMany: jest.fn(),
    },
    authenticationSession: {
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: string) => {
      const env: Record<string, string> = {
        JWT_SECRET: 'test-access-secret',
        JWT_REFRESH_SECRET: 'test-refresh-secret',
        NODE_ENV: 'test',
      };
      return env[key] ?? defaultValue;
    }),
  };

  beforeEach(async () => {
    redisStore.clear();
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        OtpService,
        JwtService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    authController = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
    otpService = module.get<OtpService>(OtpService);
  });

  describe('Phone registration + OTP send/verify', () => {
    it('registers a new user, stores a 6-digit OTP in Redis with 300s TTL, and returns wrapped response', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue({
        id: 'user-1',
        phoneNumber: '+15550100001',
        countryCode: '+1',
        username: 'alice_pro',
        displayName: 'Alice',
        role: 'USER',
        isVerified: false,
        isActive: true,
        isBanned: false,
        twoFactorEnabled: false,
        twoFactorPinHash: null,
        recoveryEmail: 'alice@example.com',
      });

      const res = await authController.register({
        phone: '+15550100001',
        country_code: '+1',
        display_name: 'Alice',
        username: 'alice_pro',
        recovery_email: 'alice@example.com',
      });

      expect(res.success).toBe(true);
      expect(res.data.otp_sent).toBe(true);
      expect(res.data.expires_in).toBe(300);
      expect((res.data.user as any).twoFactorPinHash).toBeUndefined();

      const storedOtp = redisStore.get('otp:+15550100001');
      expect(storedOtp).toMatch(/^\d{6}$/);
      expect(res.data.dev_otp).toBe(storedOtp);
      expect(mockRedisService.set).toHaveBeenCalledWith(
        'otp:+15550100001',
        storedOtp,
        300,
      );
    });

    it('rejects duplicate verified phone number during registration', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        phoneNumber: '+15550100001',
        isVerified: true,
        deletedAt: null,
      });

      await expect(
        authService.register({
          phone: '+15550100001',
          country_code: '+1',
          display_name: 'Alice',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('verifies OTP, creates device + hashed refresh session, and issues 15m/30d JWT tokens', async () => {
      redisStore.set('otp:+15550100001', '654321');
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        phoneNumber: '+15550100001',
        role: 'USER',
        isBanned: false,
        deletedAt: null,
        twoFactorEnabled: false,
        twoFactorPinHash: null,
      });
      mockPrismaService.user.update.mockResolvedValue({
        id: 'user-1',
        phoneNumber: '+15550100001',
        role: 'USER',
        isVerified: true,
        isActive: true,
        isBanned: false,
        twoFactorEnabled: false,
        twoFactorPinHash: null,
        profile: { isOnline: true },
      });

      const result = await authController.verifyOtp(
        {
          phone_number: '+15550100001',
          otp_code: '654321',
          device_info: {
            device_id: 'dev-1',
            device_name: 'Chrome Web',
            device_type: 'WEB',
            platform: 'WEB',
          },
        },
        { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as any,
      );

      expect(result.success).toBe(true);
      expect(result.data.access_token).toBeTruthy();
      expect(result.data.refresh_token).toBeTruthy();
      expect(result.data.expires_in).toBe(900);
      expect(mockPrismaService.userDevice.upsert).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.authenticationSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            deviceId: 'dev-1',
          }),
        }),
      );
      // OTP consumed from Redis
      expect(redisStore.has('otp:+15550100001')).toBe(false);
    });
  });

  describe('OTP rate limit and attempt lockout', () => {
    it('allows up to 20 OTP sends in non-production and throws 429 on the 21st send', async () => {
      for (let i = 0; i < 20; i++) {
        const res = await otpService.sendOtp('+15550100002');
        expect(res.devOtp).toMatch(/^\d{6}$/);
      }

      expect(mockRedisService.expire).toHaveBeenCalledWith('otp_rate:+15550100002', 600);

      await expect(otpService.sendOtp('+15550100002')).rejects.toThrow(
        new HttpException(
          'Too many OTP requests. Maximum 20 OTP sends per 10 minutes allowed.',
          HttpStatus.TOO_MANY_REQUESTS,
        ),
      );
    });

    it('enforces max 3 OTP sends per 10 minutes in production', async () => {
      const prodOtpService = new OtpService(
        mockRedisService as any,
        {
          get: jest.fn((key: string, def?: string) => {
            if (key === 'NODE_ENV') return 'production';
            if (key === 'TWILIO_ACCOUNT_SID') return 'AC1234567890';
            if (key === 'TWILIO_AUTH_TOKEN') return 'auth-token';
            if (key === 'TWILIO_PHONE_NUMBER') return '+15550000000';
            return def;
          }),
        } as any,
      );
      jest.spyOn(prodOtpService, 'sendOtpViaTwilio').mockResolvedValue(undefined);

      for (let i = 0; i < 3; i++) {
        const res = await prodOtpService.sendOtp('+15550100099');
        expect(res.devOtp).toBeUndefined();
      }

      await expect(prodOtpService.sendOtp('+15550100099')).rejects.toThrow(
        new HttpException(
          'Too many OTP requests. Maximum 3 OTP sends per 10 minutes allowed.',
          HttpStatus.TOO_MANY_REQUESTS,
        ),
      );
    });

    it('locks out OTP after 5 wrong verification attempts', async () => {
      redisStore.set('otp:+15550100003', '111111');

      for (let i = 0; i < 4; i++) {
        await expect(otpService.verifyOtp('+15550100003', '999999')).resolves.toBe(false);
      }

      await expect(otpService.verifyOtp('+15550100003', '999999')).rejects.toThrow(
        BadRequestException,
      );
      expect(redisStore.has('otp:+15550100003')).toBe(false);
    });
  });

  describe('JWT refresh rotation & logout', () => {
    it('rotates refresh token, revokes old session, and rejects reused old token', async () => {
      const initialTokens = await authService.generateJwtTokens({
        id: 'user-1',
        phoneNumber: '+15550100001',
        role: 'USER',
      });
      const oldHash = await authService.hashPassword(initialTokens.refreshToken);

      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'user-1',
        phoneNumber: '+15550100001',
        role: 'USER',
        isActive: true,
        isBanned: false,
        deletedAt: null,
      });
      mockPrismaService.authenticationSession.findMany.mockResolvedValue([
        {
          id: 'sess-1',
          userId: 'user-1',
          deviceId: 'dev-1',
          refreshTokenHash: oldHash,
          isRevoked: false,
          expiresAt: new Date(Date.now() + 86400000),
        },
      ]);

      const rotated = await authService.refreshTokens(
        initialTokens.refreshToken,
        '127.0.0.1',
        'jest',
      );

      expect(rotated.access_token).toBeTruthy();
      expect(rotated.refresh_token).toBeTruthy();
      expect(rotated.refresh_token).not.toBe(initialTokens.refreshToken);
      expect(mockPrismaService.authenticationSession.update).toHaveBeenCalledWith({
        where: { id: 'sess-1' },
        data: { isRevoked: true },
      });
      expect(mockPrismaService.authenticationSession.create).toHaveBeenCalled();

      // Reusing revoked session fails
      mockPrismaService.authenticationSession.findMany.mockResolvedValue([]);
      await expect(authService.refreshTokens(initialTokens.refreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('revokes session and marks user offline on logout', async () => {
      mockPrismaService.authenticationSession.findMany.mockResolvedValue([]);
      const res = await authService.logout('user-1', undefined, 'dev-1');
      expect(res.logged_out).toBe(true);
      expect(mockPrismaService.authenticationSession.updateMany).toHaveBeenCalled();
      expect(mockPrismaService.userDevice.updateMany).toHaveBeenCalled();
      expect(mockPrismaService.userProfile.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        data: expect.objectContaining({ isOnline: false }),
      });
    });
  });

  describe('Two-Factor Authentication (2FA)', () => {
    it('enables 2FA with hashed 6-digit PIN and verifies valid/invalid PINs', async () => {
      let storedPinHash = '';
      mockPrismaService.user.update.mockImplementation(async ({ data }: any) => {
        storedPinHash = data.twoFactorPinHash;
        return {
          id: 'user-1',
          twoFactorEnabled: true,
          recoveryEmail: data.recoveryEmail,
        };
      });

      const enableRes = await authController.enableTwoFactor('user-1', {
        pin: '246810',
        recovery_email: 'recovery@example.com',
      });
      expect(enableRes.data.two_factor_enabled).toBe(true);
      expect(storedPinHash).not.toBe('246810');

      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        twoFactorEnabled: true,
        twoFactorPinHash: storedPinHash,
      });

      const okRes = await authController.verifyTwoFactor('user-1', { pin: '246810' });
      expect(okRes.data.verified).toBe(true);

      await expect(authService.verify2FA('user-1', { pin: '000000' })).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('Production dev-OTP fallback & 503 dependency guards', () => {
    it('returns devOtp in production when Twilio is unconfigured unless ALLOW_DEV_OTP_FALLBACK=false', async () => {
      const prodFallbackOtpService = new OtpService(
        mockRedisService as any,
        {
          get: jest.fn((key: string, def?: string) => {
            if (key === 'NODE_ENV') return 'production';
            return def;
          }),
        } as any,
      );

      const res = await prodFallbackOtpService.sendOtp('+15550100111');
      expect(res.expiresIn).toBe(300);
      expect(res.devOtp).toMatch(/^\d{6}$/);

      const strictProdOtpService = new OtpService(
        mockRedisService as any,
        {
          get: jest.fn((key: string, def?: string) => {
            if (key === 'NODE_ENV') return 'production';
            if (key === 'ALLOW_DEV_OTP_FALLBACK') return 'false';
            return def;
          }),
        } as any,
      );

      await expect(strictProdOtpService.sendOtp('+15550100112')).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('throws ServiceUnavailableException (503) when Redis is disconnected', async () => {
      const disconnectedRedisOtpService = new OtpService(
        {
          ...mockRedisService,
          getStatus: () => ({ connected: false, error: 'Connection is closed.' }),
        } as any,
        mockConfigService as any,
      );

      await expect(disconnectedRedisOtpService.sendOtp('+15550100222')).rejects.toThrow(
        ServiceUnavailableException,
      );
      await expect(
        disconnectedRedisOtpService.verifyOtp('+15550100222', '123456'),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('throws ServiceUnavailableException (503) when Database is disconnected', async () => {
      const disconnectedDbAuthService = new AuthService(
        {
          ...mockPrismaService,
          getStatus: () => ({ connected: false, error: 'Connection refused' }),
        } as any,
        new JwtService(),
        mockConfigService as any,
        otpService,
      );

      await expect(
        disconnectedDbAuthService.sendOtp({
          phone_number: '+15550100333',
          country_code: '+1',
        }),
      ).rejects.toThrow(ServiceUnavailableException);

      await expect(
        disconnectedDbAuthService.register({
          phone: '+15550100333',
          country_code: '+1',
          display_name: 'Offline Test',
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });
});

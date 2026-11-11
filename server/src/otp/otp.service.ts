import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt, timingSafeEqual } from 'crypto';
import { Twilio } from 'twilio';
import { RedisService } from '../redis/redis.service';

const OTP_TTL_SECONDS = 300; // 5 minutes
const OTP_RATE_LIMIT_TTL_SECONDS = 600; // 10 minutes
const OTP_MAX_SENDS_PROD = 3;
const OTP_MAX_SENDS_DEV = 20;
const OTP_MAX_VERIFY_ATTEMPTS = 5;

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly twilioClient: Twilio | null = null;
  private readonly twilioFromNumber: string | undefined;

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {
    const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');
    this.twilioFromNumber = this.configService.get<string>('TWILIO_PHONE_NUMBER');

    if (
      accountSid &&
      authToken &&
      accountSid.startsWith('AC') &&
      !accountSid.includes('your_')
    ) {
      this.twilioClient = new Twilio(accountSid, authToken);
    } else {
      this.logger.warn(
        'Twilio credentials are not configured; SMS delivery will run in non-production fallback mode.',
      );
    }
  }

  /**
   * Generates a cryptographically secure 6-digit OTP code.
   */
  generateOtp(): string {
    return randomInt(100000, 1000000).toString();
  }

  /**
   * Generates, rate-limits, stores in Redis (5m TTL), and dispatches an OTP via Twilio SMS.
   */
  async sendOtp(phoneNumber: string): Promise<{ expiresIn: number; devOtp?: string }> {
    const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
    const isProduction = nodeEnv === 'production';
    const maxSends = isProduction ? OTP_MAX_SENDS_PROD : OTP_MAX_SENDS_DEV;

    const rateKey = `otp_rate:${phoneNumber}`;
    const sendCount = await this.redisService.incr(rateKey);

    if (sendCount === 1) {
      await this.redisService.expire(rateKey, OTP_RATE_LIMIT_TTL_SECONDS);
    }

    if (sendCount > maxSends) {
      throw new HttpException(
        `Too many OTP requests. Maximum ${maxSends} OTP sends per 10 minutes allowed.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const otp = this.generateOtp();
    const otpKey = `otp:${phoneNumber}`;
    const attemptsKey = `otp_attempts:${phoneNumber}`;

    await this.redisService.set(otpKey, otp, OTP_TTL_SECONDS);
    await this.redisService.del(attemptsKey);

    await this.sendOtpViaTwilio(phoneNumber, otp);

    const isTwilioConfigured = Boolean(this.twilioClient && this.twilioFromNumber);
    return {
      expiresIn: OTP_TTL_SECONDS,
      ...(!isProduction && !isTwilioConfigured ? { devOtp: otp } : {}),
    };
  }

  /**
   * Dispatches OTP code via Twilio Programmable Messaging.
   */
  async sendOtpViaTwilio(phoneNumber: string, otp: string): Promise<void> {
    const body = `Your WhatsApp Pro verification code is: ${otp}. It expires in 5 minutes.`;

    if (!this.twilioClient || !this.twilioFromNumber) {
      const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
      if (nodeEnv === 'production') {
        throw new InternalServerErrorException(
          'SMS provider is not configured for OTP delivery',
        );
      }
      this.logger.warn(
        `[DEV OTP FALLBACK] Twilio not configured. OTP generated for ${phoneNumber}: ${otp}`,
      );
      return;
    }

    try {
      const message = await this.twilioClient.messages.create({
        body,
        from: this.twilioFromNumber,
        to: phoneNumber,
      });
      this.logger.log(`OTP SMS dispatched to ${phoneNumber} (SID: ${message.sid})`);
    } catch (error) {
      this.logger.error(
        `Failed to send OTP SMS via Twilio to ${phoneNumber}: ${(error as Error).message}`,
      );
      throw new InternalServerErrorException('Failed to send OTP SMS');
    }
  }

  /**
   * Verifies a 6-digit OTP code stored in Redis and enforces attempt limits.
   */
  async verifyOtp(phoneNumber: string, otpCode: string): Promise<boolean> {
    const otpKey = `otp:${phoneNumber}`;
    const attemptsKey = `otp_attempts:${phoneNumber}`;

    const storedOtp = await this.redisService.get(otpKey);
    if (!storedOtp) {
      throw new BadRequestException('OTP has expired or does not exist');
    }

    const isLengthEqual = storedOtp.length === otpCode.length;
    const isMatch =
      isLengthEqual &&
      timingSafeEqual(Buffer.from(storedOtp, 'utf8'), Buffer.from(otpCode, 'utf8'));

    if (!isMatch) {
      const attempts = await this.redisService.incr(attemptsKey);
      if (attempts === 1) {
        await this.redisService.expire(attemptsKey, OTP_TTL_SECONDS);
      }
      if (attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
        await this.redisService.del(otpKey);
        await this.redisService.del(attemptsKey);
        throw new BadRequestException(
          'Maximum OTP verification attempts exceeded. Please request a new code.',
        );
      }
      return false;
    }

    await this.redisService.del(otpKey);
    await this.redisService.del(attemptsKey);
    return true;
  }
}

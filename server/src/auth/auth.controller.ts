import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { LogoutDto, RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { SendOtpDto } from './dto/send-otp.dto';
import { EnableTwoFactorDto, VerifyTwoFactorDto } from './dto/two-factor.dto';
import { LoginDto, VerifyOtpDto } from './dto/verify-otp.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user account and send verification OTP' })
  @ApiResponse({ status: 201, description: 'User registered and OTP sent' })
  @ApiResponse({ status: 409, description: 'Phone number or username already exists' })
  async register(@Body() dto: RegisterDto) {
    const data = await this.authService.register(dto);
    return {
      success: true,
      data,
      message: 'Registration successful. Verification OTP sent via SMS.',
    };
  }

  @Public()
  @Post('send-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a 6-digit OTP to a phone number' })
  @ApiResponse({ status: 200, description: 'OTP sent successfully' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded (max 3 per 10 minutes)' })
  async sendOtp(@Body() dto: SendOtpDto) {
    const data = await this.authService.sendOtp(dto);
    return {
      success: true,
      data,
      message: 'OTP sent successfully',
    };
  }

  @Public()
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify OTP code, register device, and issue JWT tokens' })
  @ApiResponse({ status: 200, description: 'OTP verified and authenticated' })
  @ApiResponse({ status: 401, description: 'Invalid or expired OTP' })
  async verifyOtp(@Body() dto: VerifyOtpDto, @Req() req: Request) {
    const data = await this.authService.verifyOtpAndAuthenticate(
      dto,
      req.ip,
      req.headers['user-agent'],
    );
    return {
      success: true,
      data,
      message: 'OTP verified successfully',
    };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with phone number and OTP code' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid OTP' })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const data = await this.authService.login(
      dto,
      req.ip,
      req.headers['user-agent'],
    );
    return {
      success: true,
      data,
      message: 'Login successful',
    };
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout and revoke active authentication session' })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  async logout(@CurrentUser('id') userId: string, @Body() dto: LogoutDto) {
    const data = await this.authService.logout(
      userId,
      dto?.refresh_token,
      dto?.device_id,
    );
    return {
      success: true,
      data,
      message: 'Logged out successfully',
    };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh token and issue new access/refresh tokens' })
  @ApiResponse({ status: 200, description: 'Tokens refreshed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    const data = await this.authService.refreshTokens(
      dto.refresh_token,
      req.ip,
      req.headers['user-agent'],
    );
    return {
      success: true,
      data,
      message: 'Tokens refreshed successfully',
    };
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @Post('two-factor/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enable two-factor authentication with a 6-digit PIN' })
  @ApiResponse({ status: 200, description: 'Two-factor authentication enabled' })
  async enableTwoFactor(
    @CurrentUser('id') userId: string,
    @Body() dto: EnableTwoFactorDto,
  ) {
    const data = await this.authService.enable2FA(userId, dto);
    return {
      success: true,
      data,
      message: 'Two-factor authentication enabled successfully',
    };
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @Post('two-factor/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify two-factor authentication PIN' })
  @ApiResponse({ status: 200, description: 'Two-factor PIN verified' })
  @ApiResponse({ status: 401, description: 'Invalid two-factor PIN' })
  async verifyTwoFactor(
    @CurrentUser('id') userId: string,
    @Body() dto: VerifyTwoFactorDto,
  ) {
    const data = await this.authService.verify2FA(userId, dto);
    return {
      success: true,
      data,
      message: 'Two-factor PIN verified successfully',
    };
  }
}

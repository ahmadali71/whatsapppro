import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  Length,
  IsOptional,
  Matches,
  ValidateNested,
} from 'class-validator';

export class DeviceInfoDto {
  @ApiPropertyOptional({ example: 'device-uuid-here' })
  @IsOptional()
  @IsString()
  device_id?: string;

  @ApiPropertyOptional({ example: 'iPhone 15 Pro' })
  @IsOptional()
  @IsString()
  device_name?: string;

  @ApiPropertyOptional({ example: 'MOBILE_IOS' })
  @IsOptional()
  @IsString()
  device_type?: string;

  @ApiPropertyOptional({ example: 'IOS', enum: ['WEB', 'IOS', 'ANDROID', 'WINDOWS', 'MACOS', 'LINUX'] })
  @IsOptional()
  @IsString()
  platform?: string;

  @ApiPropertyOptional({ example: 'fcm-push-token-here' })
  @IsOptional()
  @IsString()
  push_token?: string;
}

export class VerifyOtpDto {
  @ApiProperty({ example: '+15550100001', description: 'Phone number in E.164 format' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+[1-9]\d{6,14}$/, { message: 'phone_number must be in valid E.164 format' })
  phone_number: string;

  @ApiProperty({ example: '123456', description: '6-digit OTP code' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6, { message: 'otp_code must be exactly 6 digits' })
  otp_code: string;

  @ApiPropertyOptional({ type: DeviceInfoDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceInfoDto)
  device_info?: DeviceInfoDto;
}

export class LoginDto extends VerifyOtpDto {}

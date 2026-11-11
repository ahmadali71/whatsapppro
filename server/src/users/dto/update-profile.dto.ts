import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Alice Johnson', description: 'Display name' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  display_name?: string;

  @ApiPropertyOptional({ example: 'alice_pro', description: 'Unique username' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'username can only contain letters, numbers, and underscores',
  })
  username?: string;

  @ApiPropertyOptional({ example: 'Building WhatsApp Pro', description: 'Profile about/bio' })
  @IsOptional()
  @IsString()
  @MaxLength(250)
  about?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/avatar.jpg', description: 'Avatar URL' })
  @IsOptional()
  @IsString()
  avatar_url?: string;

  @ApiPropertyOptional({ example: 'alice@example.com', description: 'Recovery email' })
  @IsOptional()
  @IsEmail()
  recovery_email?: string;

  @ApiPropertyOptional({ description: 'FCM/APNs device push token' })
  @IsOptional()
  @IsString()
  push_notification_token?: string;

  @ApiPropertyOptional({ example: 'WEB', description: 'Client platform' })
  @IsOptional()
  @IsString()
  platform?: string;

  @ApiPropertyOptional({ example: '1.0.0', description: 'Application version' })
  @IsOptional()
  @IsString()
  app_version?: string;
}

export class ChangeNumberDto {
  @ApiProperty({ example: '+15550109999', description: 'New phone number in E.164 format' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+[1-9]\d{6,14}$/, { message: 'new_phone_number must be in valid E.164 format' })
  new_phone_number: string;

  @ApiProperty({ example: '+1', description: 'New country calling code or ISO code' })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(5)
  new_country_code: string;

  @ApiPropertyOptional({ example: '123456', description: '6-digit OTP sent to the new phone number' })
  @IsOptional()
  @IsString()
  @Length(6, 6)
  otp_code?: string;
}

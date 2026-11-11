import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, Length, IsOptional, IsEmail, Matches } from 'class-validator';

export class EnableTwoFactorDto {
  @ApiProperty({ example: '123456', description: '6-digit numeric PIN for 2FA' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6, { message: 'pin must be exactly 6 digits' })
  @Matches(/^\d{6}$/, { message: 'pin must contain only digits' })
  pin: string;

  @ApiPropertyOptional({ example: 'alice@example.com', description: 'Optional recovery email' })
  @IsOptional()
  @IsEmail()
  recovery_email?: string;
}

export class VerifyTwoFactorDto {
  @ApiProperty({ example: '123456', description: '6-digit 2FA PIN' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6, { message: 'pin must be exactly 6 digits' })
  @Matches(/^\d{6}$/, { message: 'pin must contain only digits' })
  pin: string;
}

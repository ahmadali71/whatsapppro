import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({ description: 'Refresh token issued during login or verify-otp' })
  @IsString()
  @IsNotEmpty()
  refresh_token: string;
}

export class LogoutDto {
  @ApiPropertyOptional({ description: 'Optional refresh token to revoke specific session' })
  @IsOptional()
  @IsString()
  refresh_token?: string;

  @ApiPropertyOptional({ description: 'Optional device ID to deactivate' })
  @IsOptional()
  @IsString()
  device_id?: string;
}

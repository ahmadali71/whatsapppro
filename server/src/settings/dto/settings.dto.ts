import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { FontSize, ThemeMode } from '@prisma/client';

export class UpdateChatSettingsDto {
  @ApiPropertyOptional({ enum: FontSize })
  @IsOptional()
  @IsEnum(FontSize)
  fontSize?: FontSize;

  @ApiPropertyOptional({ enum: FontSize, description: 'Alias for fontSize' })
  @IsOptional()
  @IsEnum(FontSize)
  font_size?: FontSize;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  enterToSend?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  mediaAutoDownloadWifi?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  mediaAutoDownloadCellular?: boolean;

  @ApiPropertyOptional({ enum: ThemeMode })
  @IsOptional()
  @IsEnum(ThemeMode)
  theme?: ThemeMode;

  @ApiPropertyOptional({ example: 'default-dark' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  wallpaper?: string | null;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  backupEnabled?: boolean;

  @ApiPropertyOptional({ enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'OFF'] })
  @IsOptional()
  @IsIn(['DAILY', 'WEEKLY', 'MONTHLY', 'OFF'])
  backupFrequency?: string;
}

export class UpdateNotificationPreferenceDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isMuted?: boolean;

  @ApiPropertyOptional({
    example: '2026-12-01T00:00:00.000Z',
    nullable: true,
  })
  @IsOptional()
  @IsDateString()
  mutedUntil?: string | null;

  @ApiPropertyOptional({ example: 'chime', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  customSound?: string | null;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  showPreview?: boolean;
}

export class TriggerBackupDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  includeMedia?: boolean;
}

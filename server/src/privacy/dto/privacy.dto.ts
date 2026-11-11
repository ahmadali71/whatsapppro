import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  Min,
} from 'class-validator';
import { StatusVisibilityScope, VisibilityScope } from '@prisma/client';

export class UpdatePrivacySettingsDto {
  @ApiPropertyOptional({ enum: VisibilityScope })
  @IsOptional()
  @IsEnum(VisibilityScope)
  lastSeenVisibility?: VisibilityScope;

  @ApiPropertyOptional({ enum: VisibilityScope })
  @IsOptional()
  @IsEnum(VisibilityScope)
  onlineVisibility?: VisibilityScope;

  @ApiPropertyOptional({ enum: VisibilityScope })
  @IsOptional()
  @IsEnum(VisibilityScope)
  profilePhotoVisibility?: VisibilityScope;

  @ApiPropertyOptional({ enum: VisibilityScope })
  @IsOptional()
  @IsEnum(VisibilityScope)
  aboutVisibility?: VisibilityScope;

  @ApiPropertyOptional({ enum: StatusVisibilityScope })
  @IsOptional()
  @IsEnum(StatusVisibilityScope)
  statusVisibility?: StatusVisibilityScope;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  readReceiptsEnabled?: boolean;

  @ApiPropertyOptional({
    example: 86400,
    nullable: true,
    description: 'Default disappearing message timeout in seconds (null to disable)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  disappearingMessagesDefault?: number | null;
}

export type DisappearingTimeoutPreset = '24h' | '7d' | '90d' | 'off';

export class SetDisappearingMessagesDto {
  @ApiProperty({
    example: '24h',
    enum: ['24h', '7d', '90d', 'off'],
    description: 'Disappearing message timeout preset: 24h, 7d, 90d, or off',
  })
  @IsIn(['24h', '7d', '90d', 'off'])
  timeout: DisappearingTimeoutPreset;
}

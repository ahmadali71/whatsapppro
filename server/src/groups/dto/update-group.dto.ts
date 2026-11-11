import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateGroupDto {
  @ApiPropertyOptional({ description: 'Updated group name' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: 'Updated group description' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'Updated group avatar URL' })
  @IsOptional()
  @IsString()
  avatar?: string;

  @ApiPropertyOptional({ description: 'Updated group avatar URL' })
  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @ApiPropertyOptional({ description: 'Restrict messaging to admins/owner only' })
  @IsOptional()
  @IsBoolean()
  onlyAdminsCanMessage?: boolean;

  @ApiPropertyOptional({ description: 'Restrict editing group info to admins/owner only' })
  @IsOptional()
  @IsBoolean()
  onlyAdminsCanEditInfo?: boolean;
}

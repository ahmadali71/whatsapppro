import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ReportStatus, UserRole } from '@prisma/client';

export class AdminPaginationDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class AdminUsersQueryDto extends AdminPaginationDto {
  @ApiPropertyOptional({ description: 'Search by phoneNumber, username, or displayName' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return undefined;
  })
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return undefined;
  })
  @IsBoolean()
  isBanned?: boolean;
}

export class SuspendUserDto {
  @ApiProperty({ example: 'Repeated spam violations', maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

export class AdminReportsQueryDto extends AdminPaginationDto {
  @ApiPropertyOptional({ enum: ReportStatus })
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;
}

export class ReviewReportDto {
  @ApiProperty({
    enum: [ReportStatus.REVIEWED, ReportStatus.RESOLVED, ReportStatus.DISMISSED],
    example: ReportStatus.RESOLVED,
  })
  @IsIn([ReportStatus.REVIEWED, ReportStatus.RESOLVED, ReportStatus.DISMISSED])
  status: 'REVIEWED' | 'RESOLVED' | 'DISMISSED';

  @ApiPropertyOptional({ example: 'User warned and offending account suspended.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class AdminAuditLogsQueryDto extends AdminPaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  actorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  entityType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

export class UpdateSystemConfigDto {
  @ApiProperty({ example: 'app_settings' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  key: string;

  @ApiProperty({
    example: { maxGroupMembers: 1024, maxMediaUploadMb: 100 },
    description: 'JSON configuration payload',
  })
  @IsNotEmpty()
  value: any;
}

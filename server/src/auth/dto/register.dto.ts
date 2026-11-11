import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: '+15550100001', description: 'Phone number in E.164 format' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+[1-9]\d{6,14}$/, { message: 'phone must be in valid E.164 format' })
  phone: string;

  @ApiProperty({ example: '+1', description: 'Country calling code or ISO code' })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(5)
  country_code: string;

  @ApiProperty({ example: 'Alice Johnson', description: 'Display name' })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(100)
  display_name: string;

  @ApiPropertyOptional({ example: 'alice_pro', description: 'Optional unique username' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'username can only contain letters, numbers, and underscores',
  })
  username?: string;

  @ApiPropertyOptional({ example: 'alice@example.com', description: 'Optional recovery email' })
  @IsOptional()
  @IsEmail()
  recovery_email?: string;
}

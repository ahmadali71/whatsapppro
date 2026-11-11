import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export enum UserSearchType {
  PHONE = 'phone',
  USERNAME = 'username',
}

export class SearchUsersDto {
  @ApiProperty({ example: 'alice', description: 'Search query (phone number or username)' })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(100)
  q: string;

  @ApiPropertyOptional({
    enum: UserSearchType,
    description: 'Filter search by phone or username',
  })
  @IsOptional()
  @IsEnum(UserSearchType)
  type?: UserSearchType;
}

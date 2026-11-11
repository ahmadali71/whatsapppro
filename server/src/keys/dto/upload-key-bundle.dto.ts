import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class OneTimePreKeyDto {
  @ApiProperty({ example: 1, description: 'Numeric one-time pre-key identifier' })
  @IsInt()
  @Min(0)
  keyId: number;

  @ApiProperty({ description: 'Base64-encoded public pre-key' })
  @IsString()
  @IsNotEmpty()
  publicKey: string;
}

export class UploadKeyBundleDto {
  @ApiPropertyOptional({ example: 'default', description: 'Device identifier' })
  @IsOptional()
  @IsString()
  deviceId?: string;

  @ApiProperty({ example: 12345, description: 'Signal registration ID' })
  @IsInt()
  @Min(1)
  registrationId: number;

  @ApiProperty({ description: 'Base64-encoded public identity key' })
  @IsString()
  @IsNotEmpty()
  identityKey: string;

  @ApiProperty({ example: 1, description: 'Signed pre-key ID' })
  @IsInt()
  @Min(0)
  signedPreKeyId: number;

  @ApiProperty({ description: 'Base64-encoded signed pre-key public key' })
  @IsString()
  @IsNotEmpty()
  signedPreKey: string;

  @ApiProperty({ description: 'Base64-encoded signed pre-key signature' })
  @IsString()
  @IsNotEmpty()
  signedPreKeySignature: string;

  @ApiProperty({ type: [OneTimePreKeyDto], description: 'Batch of one-time pre-keys' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OneTimePreKeyDto)
  oneTimePreKeys: OneTimePreKeyDto[];
}

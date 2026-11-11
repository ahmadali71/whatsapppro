import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MinLength, MaxLength, Matches } from 'class-validator';

export class SendOtpDto {
  @ApiProperty({ example: '+15550100001', description: 'Phone number in E.164 format' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+[1-9]\d{6,14}$/, { message: 'phone_number must be in valid E.164 format' })
  phone_number: string;

  @ApiProperty({ example: '+1', description: 'Country calling code or ISO code' })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(5)
  country_code: string;
}

import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class EditMessageDto {
  @ApiProperty({ description: 'Updated message content' })
  @IsString()
  @MinLength(1)
  @MaxLength(65536)
  content: string;
}

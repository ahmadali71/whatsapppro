import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ForwardMessageDto {
  @ApiProperty({ description: 'Target conversation UUID' })
  @IsUUID()
  toConversationId: string;
}

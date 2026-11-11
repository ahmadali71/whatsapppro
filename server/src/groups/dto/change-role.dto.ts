import { ApiProperty } from '@nestjs/swagger';
import { MemberRole } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class ChangeRoleDto {
  @ApiProperty({
    enum: [MemberRole.ADMIN, MemberRole.MEMBER],
    description: 'Target member role (ADMIN or MEMBER)',
  })
  @IsEnum(MemberRole)
  role: MemberRole;
}

import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { GroupsService } from './groups.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { AddMembersDto } from './dto/add-members.dto';
import { ChangeRoleDto } from './dto/change-role.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Groups')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new group and its linked group conversation' })
  @ApiResponse({ status: 201, description: 'Group created' })
  async createGroup(
    @CurrentUser('id') creatorId: string,
    @Body() dto: CreateGroupDto,
  ) {
    return this.groupsService.createGroup(creatorId, dto);
  }

  @Post('join/:inviteCode')
  @ApiOperation({ summary: 'Join a group via invite code' })
  @ApiResponse({ status: 200, description: 'Joined group via invite link' })
  async joinViaInviteLink(
    @CurrentUser('id') userId: string,
    @Param('inviteCode') inviteCode: string,
  ) {
    return this.groupsService.joinViaInviteLink(inviteCode, userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get group details and active members' })
  @ApiResponse({ status: 200, description: 'Group details' })
  async getGroup(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) groupId: string,
  ) {
    return this.groupsService.getGroupById(groupId, userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update group metadata (admin/owner only)' })
  @ApiResponse({ status: 200, description: 'Group updated' })
  async updateGroup(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) groupId: string,
    @Body() dto: UpdateGroupDto,
  ) {
    return this.groupsService.updateGroup(groupId, adminId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete group (owner only)' })
  @ApiResponse({ status: 200, description: 'Group deleted' })
  async deleteGroup(
    @CurrentUser('id') ownerId: string,
    @Param('id', ParseUUIDPipe) groupId: string,
  ) {
    return this.groupsService.deleteGroup(groupId, ownerId);
  }

  @Get(':id/members')
  @ApiOperation({ summary: 'List active members in the group' })
  @ApiResponse({ status: 200, description: 'Group members list' })
  async getMembers(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) groupId: string,
  ) {
    return this.groupsService.getMembers(groupId, userId);
  }

  @Post(':id/members')
  @ApiOperation({ summary: 'Add members to group (admin/owner only)' })
  @ApiResponse({ status: 201, description: 'Members added' })
  async addMembers(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) groupId: string,
    @Body() dto: AddMembersDto,
  ) {
    return this.groupsService.addMembers(groupId, adminId, dto.userIds);
  }

  @Delete(':id/members/:userId')
  @ApiOperation({ summary: 'Remove a member (admin removes others, member removes self)' })
  @ApiResponse({ status: 200, description: 'Member removed' })
  async removeMember(
    @CurrentUser('id') actorId: string,
    @Param('id', ParseUUIDPipe) groupId: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
  ) {
    return this.groupsService.removeMember(groupId, actorId, targetUserId);
  }

  @Patch(':id/members/:userId/role')
  @ApiOperation({ summary: 'Promote or demote a group member role (admin/owner only)' })
  @ApiResponse({ status: 200, description: 'Member role updated' })
  async changeRole(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) groupId: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Body() dto: ChangeRoleDto,
  ) {
    return this.groupsService.promoteMember(groupId, adminId, targetUserId, dto.role);
  }

  @Post(':id/invite-link')
  @ApiOperation({ summary: 'Generate a group invite link (admin/owner only)' })
  @ApiResponse({ status: 201, description: 'Invite link generated' })
  async generateInviteLink(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) groupId: string,
  ) {
    return this.groupsService.generateInviteLink(groupId, adminId);
  }

  @Delete(':id/invite-link')
  @ApiOperation({ summary: 'Revoke active group invite links (admin/owner only)' })
  @ApiResponse({ status: 200, description: 'Invite link revoked' })
  async revokeInviteLink(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) groupId: string,
  ) {
    return this.groupsService.revokeInviteLink(groupId, adminId);
  }

  @Get(':id/media')
  @ApiOperation({ summary: 'Get paginated shared media attachments in the group' })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Group media attachments' })
  async getGroupMedia(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) groupId: string,
    @Query('cursor') cursor?: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    return this.groupsService.getGroupMedia(groupId, userId, cursor, limit);
  }
}

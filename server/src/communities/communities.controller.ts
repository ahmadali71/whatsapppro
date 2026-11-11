import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CommunitiesService } from './communities.service';
import {
  AddCommunityGroupDto,
  AddCommunityMembersDto,
  CreateCommunityDto,
} from './dto/create-community.dto';
import { UpdateCommunityDto } from './dto/update-community.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Communities')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('communities')
export class CommunitiesController {
  constructor(private readonly communitiesService: CommunitiesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new community' })
  @ApiResponse({ status: 201, description: 'Community created' })
  async createCommunity(
    @CurrentUser('id') creatorId: string,
    @Body() dto: CreateCommunityDto,
  ) {
    return this.communitiesService.createCommunity(creatorId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get community details, members, and linked groups' })
  @ApiResponse({ status: 200, description: 'Community details' })
  async getCommunity(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) communityId: string,
  ) {
    return this.communitiesService.getCommunityById(communityId, userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update community metadata (admin/owner only)' })
  @ApiResponse({ status: 200, description: 'Community updated' })
  async updateCommunity(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) communityId: string,
    @Body() dto: UpdateCommunityDto,
  ) {
    return this.communitiesService.updateCommunity(communityId, adminId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete community (owner only)' })
  @ApiResponse({ status: 200, description: 'Community deleted' })
  async deleteCommunity(
    @CurrentUser('id') ownerId: string,
    @Param('id', ParseUUIDPipe) communityId: string,
  ) {
    return this.communitiesService.deleteCommunity(communityId, ownerId);
  }

  @Get(':id/members')
  @ApiOperation({ summary: 'List active community members' })
  @ApiResponse({ status: 200, description: 'Community members list' })
  async getMembers(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) communityId: string,
  ) {
    return this.communitiesService.getMembers(communityId, userId);
  }

  @Post(':id/members')
  @ApiOperation({ summary: 'Add members to community (admin/owner only)' })
  @ApiResponse({ status: 201, description: 'Community members added' })
  async addMembers(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) communityId: string,
    @Body() dto: AddCommunityMembersDto,
  ) {
    return this.communitiesService.addMembers(communityId, adminId, dto.userIds);
  }

  @Delete(':id/members/:userId')
  @ApiOperation({ summary: 'Remove a community member (admin or self)' })
  @ApiResponse({ status: 200, description: 'Community member removed' })
  async removeMember(
    @CurrentUser('id') actorId: string,
    @Param('id', ParseUUIDPipe) communityId: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
  ) {
    return this.communitiesService.removeMember(communityId, actorId, targetUserId);
  }

  @Post(':id/groups')
  @ApiOperation({ summary: 'Add an existing group to the community (admin/owner only)' })
  @ApiResponse({ status: 201, description: 'Group linked to community' })
  async addGroupToCommunity(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) communityId: string,
    @Body() dto: AddCommunityGroupDto,
  ) {
    return this.communitiesService.addGroupToCommunity(
      communityId,
      adminId,
      dto.groupId,
    );
  }

  @Delete(':id/groups/:groupId')
  @ApiOperation({ summary: 'Remove a group from the community (admin/owner only)' })
  @ApiResponse({ status: 200, description: 'Group unlinked from community' })
  async removeGroupFromCommunity(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) communityId: string,
    @Param('groupId', ParseUUIDPipe) groupId: string,
  ) {
    return this.communitiesService.removeGroupFromCommunity(
      communityId,
      adminId,
      groupId,
    );
  }
}

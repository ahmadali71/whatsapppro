import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SearchUsersDto } from './dto/search-users.dto';
import { AddContactDto, SyncContactsDto } from './dto/sync-contacts.dto';
import { ChangeNumberDto, UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current authenticated user profile and settings' })
  @ApiResponse({ status: 200, description: 'Current user profile retrieved' })
  async getMe(@CurrentUser('id') userId: string) {
    const data = await this.usersService.getMe(userId);
    return {
      success: true,
      data,
      message: 'User profile retrieved successfully',
    };
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update current user profile and push notification metadata' })
  @ApiResponse({ status: 200, description: 'User profile updated' })
  async updateMe(@CurrentUser('id') userId: string, @Body() dto: UpdateProfileDto) {
    const data = await this.usersService.updateMe(userId, dto);
    return {
      success: true,
      data,
      message: 'User profile updated successfully',
    };
  }

  @Delete('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete (soft-deactivate) current user account' })
  @ApiResponse({ status: 200, description: 'Account deleted successfully' })
  async deleteMe(@CurrentUser('id') userId: string) {
    const data = await this.usersService.deleteMe(userId);
    return {
      success: true,
      data,
      message: 'Account deleted successfully',
    };
  }

  @Post('change-number')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change authenticated user phone number' })
  @ApiResponse({ status: 200, description: 'Phone number changed successfully' })
  async changeNumber(@CurrentUser('id') userId: string, @Body() dto: ChangeNumberDto) {
    const data = await this.usersService.changeNumber(userId, dto);
    return {
      success: true,
      data,
      message: 'Phone number updated successfully',
    };
  }

  @Get('search')
  @ApiOperation({ summary: 'Search users by phone number or username' })
  @ApiResponse({ status: 200, description: 'Matching users returned' })
  async searchUsers(
    @CurrentUser('id') userId: string,
    @Query() query: SearchUsersDto,
  ) {
    const data = await this.usersService.searchUsers(userId, query);
    return {
      success: true,
      data,
      message: 'Users search completed',
    };
  }

  @Get('blocked')
  @ApiOperation({ summary: 'Get list of blocked users' })
  @ApiResponse({ status: 200, description: 'Blocked users retrieved' })
  async getBlockedUsers(@CurrentUser('id') userId: string) {
    const data = await this.usersService.getBlockedUsers(userId);
    return {
      success: true,
      data,
      message: 'Blocked users retrieved successfully',
    };
  }

  @Post('block/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Block a user by ID' })
  @ApiParam({ name: 'id', description: 'Target user UUID to block' })
  @ApiResponse({ status: 200, description: 'User blocked successfully' })
  async blockUser(@CurrentUser('id') userId: string, @Param('id') targetId: string) {
    const data = await this.usersService.blockUser(userId, targetId);
    return {
      success: true,
      data,
      message: 'User blocked successfully',
    };
  }

  @Delete('block/:id')
  @ApiOperation({ summary: 'Unblock a user by ID' })
  @ApiParam({ name: 'id', description: 'Target user UUID to unblock' })
  @ApiResponse({ status: 200, description: 'User unblocked successfully' })
  async unblockUser(@CurrentUser('id') userId: string, @Param('id') targetId: string) {
    const data = await this.usersService.unblockUser(userId, targetId);
    return {
      success: true,
      data,
      message: 'User unblocked successfully',
    };
  }

  @Post('contacts')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a single registered contact by phone number' })
  @ApiResponse({ status: 201, description: 'Contact added successfully' })
  @ApiResponse({ status: 404, description: 'Registered user not found for phone number' })
  async addContact(@CurrentUser('id') userId: string, @Body() dto: AddContactDto) {
    const data = await this.usersService.addContact(userId, dto);
    return {
      success: true,
      data,
      message: 'Contact added successfully',
    };
  }

  @Post('contacts/sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch sync device contacts with registered WhatsApp Pro users' })
  @ApiResponse({ status: 200, description: 'Contacts synced successfully' })
  async syncContacts(@CurrentUser('id') userId: string, @Body() dto: SyncContactsDto) {
    const data = await this.usersService.syncContacts(userId, dto);
    return {
      success: true,
      data,
      message: 'Contacts synced successfully',
    };
  }

  @Get('contacts')
  @ApiOperation({ summary: 'Get all synced contacts for current user' })
  @ApiResponse({ status: 200, description: 'Contacts retrieved successfully' })
  async getContacts(@CurrentUser('id') userId: string) {
    const data = await this.usersService.getContacts(userId);
    return {
      success: true,
      data,
      message: 'Contacts retrieved successfully',
    };
  }

  @Delete('contacts/:contactId')
  @ApiOperation({ summary: 'Remove a saved contact by contact user ID or record ID' })
  @ApiParam({ name: 'contactId', description: 'Contact user ID or contact record ID' })
  @ApiResponse({ status: 200, description: 'Contact removed successfully' })
  async removeContact(
    @CurrentUser('id') userId: string,
    @Param('contactId') contactId: string,
  ) {
    const data = await this.usersService.removeContact(userId, contactId);
    return {
      success: true,
      data,
      message: 'Contact removed successfully',
    };
  }

  @Get('devices')
  @ApiOperation({ summary: 'Get linked devices for current user' })
  @ApiResponse({ status: 200, description: 'Linked devices retrieved' })
  async getDevices(@CurrentUser('id') userId: string) {
    const data = await this.usersService.getDevices(userId);
    return {
      success: true,
      data,
      message: 'Linked devices retrieved successfully',
    };
  }

  @Delete('devices/:deviceId')
  @ApiOperation({ summary: 'Unlink/revoke a linked device and its sessions' })
  @ApiParam({ name: 'deviceId', description: 'Device ID or record UUID' })
  @ApiResponse({ status: 200, description: 'Device revoked successfully' })
  async revokeDevice(
    @CurrentUser('id') userId: string,
    @Param('deviceId') deviceId: string,
  ) {
    const data = await this.usersService.revokeDevice(userId, deviceId);
    return {
      success: true,
      data,
      message: 'Device unlinked successfully',
    };
  }

  @Get(':id/profile')
  @ApiOperation({ summary: 'Get another user profile respecting privacy settings' })
  @ApiParam({ name: 'id', description: 'Target user UUID' })
  @ApiResponse({ status: 200, description: 'User profile retrieved' })
  async getUserProfile(@CurrentUser('id') userId: string, @Param('id') targetId: string) {
    const data = await this.usersService.getUserProfile(userId, targetId);
    return {
      success: true,
      data,
      message: 'User profile retrieved successfully',
    };
  }
}

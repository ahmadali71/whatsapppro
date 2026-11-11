import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  TriggerBackupDto,
  UpdateChatSettingsDto,
  UpdateNotificationPreferenceDto,
} from './dto/settings.dto';
import { SettingsService } from './settings.service';

@ApiTags('Settings')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  private getUserId(req: any): string {
    return req.user?.id ?? req.user?.userId ?? req.user?.sub;
  }

  @Get('chat')
  @ApiOperation({ summary: 'Get user chat settings' })
  @ApiResponse({ status: 200, description: 'Chat settings retrieved' })
  async getChatSettings(@Req() req: any) {
    const data = await this.settingsService.getChatSettings(this.getUserId(req));
    return { success: true, data, message: 'Chat settings retrieved successfully' };
  }

  @Patch('chat')
  @ApiOperation({ summary: 'Update user chat settings' })
  @ApiResponse({ status: 200, description: 'Chat settings updated' })
  async updateChatSettings(@Req() req: any, @Body() dto: UpdateChatSettingsDto) {
    const data = await this.settingsService.updateChatSettings(this.getUserId(req), dto);
    return { success: true, data, message: 'Chat settings updated successfully' };
  }

  @Get('notifications')
  @ApiOperation({ summary: 'Get notification preferences per conversation' })
  @ApiResponse({ status: 200, description: 'Notification preferences retrieved' })
  async getNotificationPreferences(@Req() req: any) {
    const data = await this.settingsService.getNotificationPreferences(
      this.getUserId(req),
    );
    return {
      success: true,
      data,
      message: 'Notification preferences retrieved successfully',
    };
  }

  @Patch('notifications/:conversationId')
  @ApiOperation({ summary: 'Mute/unmute or set custom notification sound for a conversation' })
  @ApiResponse({ status: 200, description: 'Notification preference updated' })
  async updateConversationNotification(
    @Req() req: any,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() dto: UpdateNotificationPreferenceDto,
  ) {
    const data = await this.settingsService.updateConversationNotification(
      this.getUserId(req),
      conversationId,
      dto,
    );
    return {
      success: true,
      data,
      message: 'Notification preferences updated successfully',
    };
  }

  @Get('storage')
  @ApiOperation({ summary: 'Get storage usage stats per conversation' })
  @ApiResponse({ status: 200, description: 'Storage stats retrieved' })
  async getStorageStats(@Req() req: any) {
    const data = await this.settingsService.getStorageStats(this.getUserId(req));
    return { success: true, data, message: 'Storage usage retrieved successfully' };
  }

  @Delete('storage/:conversationId')
  @ApiOperation({ summary: 'Clear media attachments for a conversation' })
  @ApiResponse({ status: 200, description: 'Conversation media cleared' })
  async clearConversationStorage(
    @Req() req: any,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ) {
    const data = await this.settingsService.clearConversationStorage(
      this.getUserId(req),
      conversationId,
    );
    return {
      success: true,
      data,
      message: 'Conversation media cleared successfully',
    };
  }

  @Post('backup')
  @ApiOperation({ summary: 'Trigger a chat backup' })
  @ApiResponse({ status: 201, description: 'Chat backup triggered' })
  async triggerBackup(@Req() req: any, @Body() dto: TriggerBackupDto) {
    const data = await this.settingsService.triggerBackup(this.getUserId(req), dto);
    return { success: true, data, message: 'Chat backup completed successfully' };
  }
}

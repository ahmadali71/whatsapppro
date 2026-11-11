import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  SetDisappearingMessagesDto,
  UpdatePrivacySettingsDto,
} from './dto/privacy.dto';
import { PrivacyService } from './privacy.service';

@ApiTags('Privacy')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('privacy')
export class PrivacyController {
  constructor(private readonly privacyService: PrivacyService) {}

  private getUserId(req: any): string {
    return req.user?.id ?? req.user?.userId ?? req.user?.sub;
  }

  @Get('settings')
  @ApiOperation({ summary: 'Get current user privacy settings' })
  @ApiResponse({ status: 200, description: 'Privacy settings retrieved' })
  async getPrivacySettings(@Req() req: any) {
    const data = await this.privacyService.getPrivacySettings(this.getUserId(req));
    return { success: true, data, message: 'Privacy settings retrieved successfully' };
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update current user privacy settings' })
  @ApiResponse({ status: 200, description: 'Privacy settings updated' })
  async updatePrivacySettings(
    @Req() req: any,
    @Body() dto: UpdatePrivacySettingsDto,
  ) {
    const data = await this.privacyService.updatePrivacySettings(
      this.getUserId(req),
      dto,
    );
    return { success: true, data, message: 'Privacy settings updated successfully' };
  }

  @Post('disappearing-messages/:conversationId')
  @ApiOperation({ summary: 'Set disappearing messages timeout for a conversation' })
  @ApiResponse({ status: 201, description: 'Disappearing messages timeout updated' })
  async setDisappearingMessages(
    @Req() req: any,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() dto: SetDisappearingMessagesDto,
  ) {
    const data = await this.privacyService.setDisappearingMessages(
      conversationId,
      this.getUserId(req),
      dto.timeout,
    );
    return {
      success: true,
      data,
      message: 'Disappearing messages setting updated successfully',
    };
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Get active authentication sessions for current user' })
  @ApiResponse({ status: 200, description: 'Active sessions retrieved' })
  async getActiveSessions(@Req() req: any) {
    const data = await this.privacyService.getActiveSessions(this.getUserId(req));
    return { success: true, data, message: 'Active sessions retrieved successfully' };
  }

  @Delete('sessions/:id')
  @ApiOperation({ summary: 'Revoke a specific authentication session' })
  @ApiResponse({ status: 200, description: 'Session revoked' })
  async revokeSession(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const data = await this.privacyService.revokeSession(this.getUserId(req), id);
    return { success: true, data, message: 'Session revoked successfully' };
  }

  @Delete('sessions')
  @ApiOperation({ summary: 'Revoke all other active sessions' })
  @ApiResponse({ status: 200, description: 'Other sessions revoked' })
  async revokeOtherSessions(
    @Req() req: any,
    @Headers('x-device-id') deviceId?: string,
    @Query('currentSessionId') currentSessionId?: string,
  ) {
    const data = await this.privacyService.revokeOtherSessions(
      this.getUserId(req),
      currentSessionId ?? req.user?.sessionId,
      deviceId ?? req.user?.deviceId,
    );
    return { success: true, data, message: 'Other sessions revoked successfully' };
  }
}

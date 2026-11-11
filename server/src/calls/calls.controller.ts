import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
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
import { CallsService } from './calls.service';
import { InitiateCallDto } from './dto/initiate-call.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Calls')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('calls')
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  @Get('ice-servers')
  @ApiOperation({ summary: 'Get WebRTC STUN/TURN ICE server configuration' })
  @ApiResponse({ status: 200, description: 'ICE servers and WebRTC topology config' })
  getIceServers() {
    return this.callsService.getWebRtcConfig();
  }

  @Get('history')
  @ApiOperation({ summary: 'Get paginated call history for the current user' })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Paginated call history' })
  async getCallHistory(
    @CurrentUser('id') userId: string,
    @Query('cursor') cursor?: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    return this.callsService.getCallHistory(userId, cursor, limit);
  }

  @Get('active')
  @ApiOperation({ summary: 'Get active ongoing or ringing call for current user' })
  @ApiResponse({ status: 200, description: 'Active call or null' })
  async getActiveCall(@CurrentUser('id') userId: string) {
    return this.callsService.getActiveCall(userId);
  }

  @Post()
  @ApiOperation({ summary: 'Initiate an audio or video WebRTC call' })
  @ApiResponse({ status: 201, description: 'Call initiated and members notified' })
  async initiateCall(
    @CurrentUser('id') userId: string,
    @Body() dto: InitiateCallDto,
  ) {
    return this.callsService.initiateCall(
      userId,
      dto.conversationId,
      dto.callType,
    );
  }

  @Post(':id/join')
  @ApiOperation({ summary: 'Join an active call and retrieve mesh peers' })
  @ApiResponse({ status: 200, description: 'Joined call successfully' })
  async joinCall(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) callId: string,
  ) {
    return this.callsService.joinCall(callId, userId);
  }

  @Post(':id/end')
  @ApiOperation({ summary: 'End or leave a call' })
  @ApiResponse({ status: 200, description: 'Call ended' })
  async endCall(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) callId: string,
  ) {
    return this.callsService.endCall(callId, userId);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject an incoming call' })
  @ApiResponse({ status: 200, description: 'Call rejected' })
  async rejectCall(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) callId: string,
  ) {
    return this.callsService.rejectCall(callId, userId);
  }
}

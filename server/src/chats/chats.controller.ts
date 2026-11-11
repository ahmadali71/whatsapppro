import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  ParseUUIDPipe,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiQuery } from '@nestjs/swagger';
import { ChatsService } from './chats.service';
import { PaginateDto } from './dto/paginate.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { EditMessageDto } from './dto/edit-message.dto';
import { ForwardMessageDto } from './dto/forward-message.dto';
import {
  CreateDirectChatDto,
  AddReactionDto,
  DeleteMessageQueryDto,
  PollVoteDto,
  LinkPreviewQueryDto,
} from './dto/chat-actions.dto';

interface AuthenticatedRequest {
  user?: {
    id?: string;
    userId?: string;
    sub?: string;
  };
}

@ApiTags('Chats & Messages')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard('jwt'))
@Controller()
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  private getUserId(req: AuthenticatedRequest): string {
    const userId = req.user?.id ?? req.user?.userId ?? req.user?.sub;
    if (!userId) {
      throw new UnauthorizedException('Invalid authenticated user payload');
    }
    return userId;
  }

  // ─────────────────────────── Conversations ───────────────────────────────

  @Get('chats')
  @ApiOperation({ summary: 'Get paginated conversation list for current user' })
  async getChats(@Req() req: AuthenticatedRequest, @Query() query: PaginateDto) {
    const userId = this.getUserId(req);
    return this.chatsService.getConversations(
      userId,
      query.cursor,
      query.limit,
      query.archived,
      query.search,
    );
  }

  @Post('chats')
  @ApiOperation({ summary: 'Create or retrieve a direct conversation' })
  async createDirectChat(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateDirectChatDto,
  ) {
    const userId = this.getUserId(req);
    return this.chatsService.createDirectConversation(userId, dto.otherUserId);
  }

  @Get('chats/link-preview')
  @ApiOperation({ summary: 'Fetch OpenGraph link preview metadata (SSRF-protected)' })
  @ApiQuery({ name: 'url', required: true })
  async getLinkPreview(@Query() query: LinkPreviewQueryDto) {
    return this.chatsService.getLinkPreview(query.url);
  }

  @Get('chats/:id')
  @ApiOperation({ summary: 'Get conversation details' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async getChatDetails(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const userId = this.getUserId(req);
    return this.chatsService.getConversationDetails(id, userId);
  }

  @Get('chats/:id/pinned')
  @ApiOperation({ summary: 'Get pinned messages for a conversation' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async getPinnedMessages(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) conversationId: string,
  ) {
    const userId = this.getUserId(req);
    return this.chatsService.getPinnedMessages(conversationId, userId);
  }

  @Post('chats/:id/archive')
  @ApiOperation({ summary: 'Archive a conversation for the current user' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async archiveChat(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const userId = this.getUserId(req);
    return this.chatsService.archiveConversation(id, userId);
  }

  @Delete('chats/:id/archive')
  @ApiOperation({ summary: 'Unarchive a conversation for the current user' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async unarchiveChat(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const userId = this.getUserId(req);
    return this.chatsService.unarchiveConversation(id, userId);
  }

  // ─────────────────────────── Messages ────────────────────────────────────

  @Get('chats/:id/messages')
  @ApiOperation({ summary: 'Get cursor-paginated messages for a conversation' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async getMessages(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) conversationId: string,
    @Query() query: PaginateDto,
  ) {
    const userId = this.getUserId(req);
    return this.chatsService.getMessages(
      conversationId,
      userId,
      query.cursor,
      query.limit,
    );
  }

  @Post('chats/:id/messages')
  @ApiOperation({ summary: 'Send a message to a conversation' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async sendMessage(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) conversationId: string,
    @Body() dto: CreateMessageDto,
  ) {
    const userId = this.getUserId(req);
    return this.chatsService.sendMessage(userId, conversationId, dto);
  }

  @Post('chats/:id/read')
  @ApiOperation({ summary: 'Mark a message as read in a conversation' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async markConversationRead(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) conversationId: string,
    @Body('messageId', ParseUUIDPipe) messageId: string,
  ) {
    const userId = this.getUserId(req);
    return this.chatsService.markAsRead(userId, conversationId, messageId);
  }

  // Static route MUST precede parameterized :id routes
  @Get('messages/starred')
  @ApiOperation({ summary: 'Get all starred messages for current user' })
  async getStarredMessages(
    @Req() req: AuthenticatedRequest,
    @Query() query: PaginateDto,
  ) {
    const userId = this.getUserId(req);
    return this.chatsService.getStarredMessages(userId, query.cursor, query.limit);
  }

  @Patch('messages/:id')
  @ApiOperation({ summary: 'Edit a sent message' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async editMessage(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) messageId: string,
    @Body() dto: EditMessageDto,
  ) {
    const userId = this.getUserId(req);
    return this.chatsService.editMessage(userId, messageId, dto.content);
  }

  @Delete('messages/:id')
  @ApiOperation({ summary: 'Delete a message for me or for everyone' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiQuery({ name: 'deleteForEveryone', required: false, type: Boolean })
  async deleteMessage(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) messageId: string,
    @Query() query: DeleteMessageQueryDto,
  ) {
    const userId = this.getUserId(req);
    return this.chatsService.deleteMessage(
      userId,
      messageId,
      Boolean(query.deleteForEveryone),
    );
  }

  @Post('messages/:id/reactions')
  @ApiOperation({ summary: 'Add or toggle an emoji reaction on a message' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async addReaction(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) messageId: string,
    @Body() dto: AddReactionDto,
  ) {
    const userId = this.getUserId(req);
    return this.chatsService.addReaction(userId, messageId, dto.emoji);
  }

  @Delete('messages/:id/reactions/:emoji')
  @ApiOperation({ summary: 'Remove an emoji reaction from a message' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async removeReaction(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) messageId: string,
    @Param('emoji') emoji: string,
  ) {
    const userId = this.getUserId(req);
    return this.chatsService.removeReaction(userId, messageId, decodeURIComponent(emoji));
  }

  @Post('messages/:id/star')
  @ApiOperation({ summary: 'Star a message' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async starMessage(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) messageId: string,
  ) {
    const userId = this.getUserId(req);
    return this.chatsService.starMessage(userId, messageId);
  }

  @Delete('messages/:id/star')
  @ApiOperation({ summary: 'Unstar a message' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async unstarMessage(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) messageId: string,
  ) {
    const userId = this.getUserId(req);
    return this.chatsService.unstarMessage(userId, messageId);
  }

  @Post('messages/:id/forward')
  @ApiOperation({ summary: 'Forward a message to another conversation' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async forwardMessage(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) messageId: string,
    @Body() dto: ForwardMessageDto,
  ) {
    const userId = this.getUserId(req);
    return this.chatsService.forwardMessage(userId, messageId, dto.toConversationId);
  }

  @Post('messages/:id/pin')
  @ApiOperation({ summary: 'Pin a message in its conversation' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async pinMessage(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) messageId: string,
  ) {
    const userId = this.getUserId(req);
    return this.chatsService.pinMessage(userId, messageId);
  }

  @Delete('messages/:id/pin')
  @ApiOperation({ summary: 'Unpin a message from its conversation' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async unpinMessage(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) messageId: string,
  ) {
    const userId = this.getUserId(req);
    return this.chatsService.unpinMessage(userId, messageId);
  }

  @Post('messages/:id/poll-vote')
  @ApiOperation({ summary: 'Cast or toggle a vote on a poll message' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async votePoll(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) messageId: string,
    @Body() dto: PollVoteDto,
  ) {
    const userId = this.getUserId(req);
    return this.chatsService.votePoll(userId, messageId, dto);
  }

  @Get('messages/:id/info')
  @ApiOperation({ summary: 'Get per-member delivery and read receipt timestamps for a message' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async getMessageInfo(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) messageId: string,
  ) {
    const userId = this.getUserId(req);
    return this.chatsService.getMessageInfo(userId, messageId);
  }
}

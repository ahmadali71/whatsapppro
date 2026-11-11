import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateStatusDto, ReactStatusDto, ReplyStatusDto } from './dto/create-status.dto';
import { StatusesService } from './statuses.service';

@ApiTags('Statuses')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('statuses')
export class StatusesController {
  constructor(private readonly statusesService: StatusesService) {}

  private getUserId(req: any): string {
    return req.user?.id ?? req.user?.userId ?? req.user?.sub;
  }

  @Post()
  @ApiOperation({ summary: 'Create a new status (WhatsApp Story)' })
  @ApiResponse({ status: 201, description: 'Status created successfully' })
  async createStatus(@Req() req: any, @Body() dto: CreateStatusDto) {
    const data = await this.statusesService.createStatus(this.getUserId(req), dto);
    return { success: true, data, message: 'Status created successfully' };
  }

  @Get()
  @ApiOperation({ summary: 'Get active statuses from contacts respecting privacy settings' })
  @ApiResponse({ status: 200, description: 'Contacts statuses retrieved' })
  async getContactsStatuses(@Req() req: any) {
    const data = await this.statusesService.getContactsStatuses(this.getUserId(req));
    return { success: true, data, message: 'Statuses retrieved successfully' };
  }

  @Get('mine')
  @ApiOperation({ summary: 'Get current user active statuses with viewers and reactions' })
  @ApiResponse({ status: 200, description: 'Own statuses retrieved' })
  async getMyStatuses(@Req() req: any) {
    const data = await this.statusesService.getMyStatuses(this.getUserId(req));
    return { success: true, data, message: 'Your statuses retrieved successfully' };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete own status' })
  @ApiResponse({ status: 200, description: 'Status deleted' })
  async deleteStatus(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const data = await this.statusesService.deleteStatus(id, this.getUserId(req));
    return { success: true, data, message: 'Status deleted successfully' };
  }

  @Post(':id/views')
  @ApiOperation({ summary: 'Mark a status as viewed' })
  @ApiResponse({ status: 201, description: 'Status marked as viewed' })
  async viewStatus(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const data = await this.statusesService.viewStatus(id, this.getUserId(req));
    return { success: true, data, message: 'Status view recorded' };
  }

  @Get(':id/viewers')
  @ApiOperation({ summary: 'Get viewers list for a status (owner only)' })
  @ApiResponse({ status: 200, description: 'Status viewers retrieved' })
  async getStatusViewers(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const data = await this.statusesService.getStatusViewers(id, this.getUserId(req));
    return { success: true, data, message: 'Status viewers retrieved successfully' };
  }

  @Post(':id/reactions')
  @ApiOperation({ summary: 'React to a status with an emoji' })
  @ApiResponse({ status: 201, description: 'Reaction saved' })
  async reactToStatus(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReactStatusDto,
  ) {
    const data = await this.statusesService.reactToStatus(id, this.getUserId(req), dto.emoji);
    return { success: true, data, message: 'Reaction recorded' };
  }

  @Post(':id/reply')
  @ApiOperation({ summary: 'Reply to a status (creates direct message)' })
  @ApiResponse({ status: 201, description: 'Reply sent as direct message' })
  async replyToStatus(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplyStatusDto,
  ) {
    const data = await this.statusesService.replyToStatus(
      id,
      this.getUserId(req),
      dto.message,
    );
    return { success: true, data, message: 'Reply sent successfully' };
  }
}

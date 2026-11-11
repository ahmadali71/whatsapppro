import {
  Body,
  Controller,
  Delete,
  Get,
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
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import {
  AdminAuditLogsQueryDto,
  AdminReportsQueryDto,
  AdminUsersQueryDto,
  ReviewReportDto,
  SuspendUserDto,
  UpdateSystemConfigDto,
} from './dto/admin.dto';

@ApiTags('Admin')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  private getUserId(req: any): string {
    return req.user?.id ?? req.user?.userId ?? req.user?.sub;
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get admin dashboard metadata statistics' })
  @ApiResponse({ status: 200, description: 'Dashboard stats retrieved' })
  async getStats() {
    const data = await this.adminService.getDashboardStats();
    return { success: true, data, message: 'Dashboard stats retrieved successfully' };
  }

  @Get('users')
  @ApiOperation({ summary: 'Get paginated list of users with filters' })
  @ApiResponse({ status: 200, description: 'Users list retrieved' })
  async getUsers(@Query() query: AdminUsersQueryDto) {
    const data = await this.adminService.getUsers(query);
    return { success: true, data, message: 'Users retrieved successfully' };
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Get user metadata details (no message content)' })
  @ApiResponse({ status: 200, description: 'User details retrieved' })
  async getUserDetails(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.adminService.getUserDetails(id);
    return { success: true, data, message: 'User details retrieved successfully' };
  }

  @Post('users/:id/suspend')
  @ApiOperation({ summary: 'Suspend a user account' })
  @ApiResponse({ status: 200, description: 'User account suspended' })
  async suspendUser(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendUserDto,
  ) {
    const data = await this.adminService.suspendUser(
      this.getUserId(req),
      id,
      dto.reason,
      req.ip,
    );
    return { success: true, data, message: 'User suspended successfully' };
  }

  @Post('users/:id/restore')
  @ApiOperation({ summary: 'Restore a suspended user account' })
  @ApiResponse({ status: 200, description: 'User account restored' })
  async restoreUser(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const data = await this.adminService.restoreUser(
      this.getUserId(req),
      id,
      req.ip,
    );
    return { success: true, data, message: 'User restored successfully' };
  }

  @Delete('users/:id')
  @ApiOperation({ summary: 'Soft delete a user account' })
  @ApiResponse({ status: 200, description: 'User account deleted' })
  async deleteUser(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const data = await this.adminService.deleteUser(
      this.getUserId(req),
      id,
      req.ip,
    );
    return { success: true, data, message: 'User deleted successfully' };
  }

  @Get('reports')
  @ApiOperation({ summary: 'Get paginated abuse reports list' })
  @ApiResponse({ status: 200, description: 'Reports retrieved' })
  async getReports(@Query() query: AdminReportsQueryDto) {
    const data = await this.adminService.getReports(query);
    return { success: true, data, message: 'Reports retrieved successfully' };
  }

  @Get('reports/:id')
  @ApiOperation({ summary: 'Get report details with flagged message metadata (no content)' })
  @ApiResponse({ status: 200, description: 'Report details retrieved' })
  async getReportDetails(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.adminService.getReportDetails(id);
    return { success: true, data, message: 'Report details retrieved successfully' };
  }

  @Patch('reports/:id')
  @ApiOperation({ summary: 'Review and update report status' })
  @ApiResponse({ status: 200, description: 'Report status updated' })
  async reviewReport(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewReportDto,
  ) {
    const data = await this.adminService.reviewReport(
      this.getUserId(req),
      id,
      dto,
      req.ip,
    );
    return { success: true, data, message: 'Report updated successfully' };
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'Get paginated audit logs with filters' })
  @ApiResponse({ status: 200, description: 'Audit logs retrieved' })
  async getAuditLogs(@Query() query: AdminAuditLogsQueryDto) {
    const data = await this.adminService.getAuditLogs(query);
    return { success: true, data, message: 'Audit logs retrieved successfully' };
  }

  @Get('health')
  @ApiOperation({ summary: 'Check server health (DB, Redis, S3 storage)' })
  @ApiResponse({ status: 200, description: 'System health status retrieved' })
  async getHealth() {
    const data = await this.adminService.checkSystemHealth();
    return { success: true, data, message: 'Health check completed' };
  }

  @Get('storage')
  @ApiOperation({ summary: 'Get global storage usage statistics (metadata only)' })
  @ApiResponse({ status: 200, description: 'Storage stats retrieved' })
  async getStorageStats() {
    const data = await this.adminService.getStorageUsageStats();
    return { success: true, data, message: 'Storage statistics retrieved successfully' };
  }

  @Get('config')
  @ApiOperation({ summary: 'Get all system configuration entries' })
  @ApiResponse({ status: 200, description: 'System configs retrieved' })
  async getConfig() {
    const data = await this.adminService.getSystemConfigs();
    return { success: true, data, message: 'System config retrieved successfully' };
  }

  @Post('config')
  @ApiOperation({ summary: 'Create or update a system configuration entry' })
  @ApiResponse({ status: 201, description: 'System config updated' })
  async updateConfig(@Req() req: any, @Body() dto: UpdateSystemConfigDto) {
    const data = await this.adminService.updateSystemConfig(
      this.getUserId(req),
      dto,
      req.ip,
    );
    return { success: true, data, message: 'System config updated successfully' };
  }
}

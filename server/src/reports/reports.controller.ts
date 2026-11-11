import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  private getUserId(req: any): string {
    return req.user?.id ?? req.user?.userId ?? req.user?.sub;
  }

  @Post()
  @ApiOperation({ summary: 'Submit a user or message abuse report' })
  @ApiResponse({ status: 201, description: 'Report submitted successfully' })
  async createReport(@Req() req: any, @Body() dto: CreateReportDto) {
    const data = await this.reportsService.createReport(this.getUserId(req), dto);
    return { success: true, data, message: 'Report submitted successfully' };
  }
}

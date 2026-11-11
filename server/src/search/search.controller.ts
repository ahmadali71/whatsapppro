import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SearchQueryDto } from './dto/search-query.dto';
import { SearchService } from './search.service';

@ApiTags('Search')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  private getUserId(req: any): string {
    return req.user?.id ?? req.user?.userId ?? req.user?.sub;
  }

  @Get()
  @ApiOperation({
    summary: 'Global search across contacts, messages, groups, and media',
  })
  @ApiResponse({ status: 200, description: 'Search results returned' })
  async search(@Req() req: any, @Query() queryDto: SearchQueryDto) {
    const { q, type = 'all', ...filters } = queryDto;
    const data = await this.searchService.globalSearch(
      this.getUserId(req),
      q,
      type,
      filters,
    );
    return { success: true, data, message: 'Search completed successfully' };
  }
}

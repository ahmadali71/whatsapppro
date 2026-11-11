import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UploadKeyBundleDto } from './dto/upload-key-bundle.dto';
import { KeysService } from './keys.service';

@ApiTags('E2EE Keys')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('keys')
export class KeysController {
  constructor(private readonly keysService: KeysService) {}

  @Post('bundle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Upload or update Signal Protocol public identity and pre-key bundle' })
  @ApiResponse({ status: 200, description: 'Key bundle uploaded successfully' })
  async uploadBundle(
    @CurrentUser('id') userId: string,
    @Body() dto: UploadKeyBundleDto,
  ) {
    const data = await this.keysService.uploadKeyBundle(userId, dto);
    return {
      success: true,
      data,
      message: 'E2EE key bundle uploaded successfully',
    };
  }

  @Get('bundle/:userId')
  @ApiOperation({ summary: 'Fetch recipient Signal Protocol key bundle and consume one pre-key' })
  @ApiParam({ name: 'userId', description: 'Recipient user UUID' })
  @ApiQuery({ name: 'deviceId', required: false, description: 'Optional target device ID' })
  @ApiResponse({ status: 200, description: 'Key bundle retrieved' })
  async getBundle(
    @Param('userId') targetUserId: string,
    @Query('deviceId') deviceId?: string,
  ) {
    const data = await this.keysService.consumeKeyBundle(targetUserId, deviceId);
    return {
      success: true,
      data,
      message: 'E2EE key bundle retrieved successfully',
    };
  }
}

import {
  Controller,
  Post,
  Get,
  Delete,
  Query,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  ApiTags,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { MediaService, MediaCategory } from './media.service';

@ApiTags('Media')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard('jwt'))
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('upload')
  @ApiOperation({ summary: 'Upload an image, video, document, or voice note to S3' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        folder: { type: 'string', default: 'messages' },
        type: {
          type: 'string',
          enum: ['image', 'video', 'document', 'voice', 'audio'],
        },
        compress: { type: 'boolean', default: true },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB ceiling; refined per category
    }),
  )
  async uploadMedia(
    @UploadedFile() file: Express.Multer.File,
    @Body('folder') folder = 'messages',
    @Body('type') explicitType?: MediaCategory,
    @Body('compress') compress?: string,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    const category = this.mediaService.resolveCategoryFromMime(
      file.mimetype,
      explicitType,
    );

    this.mediaService.validateFileSize(file.size, category);

    let bufferToUpload = file.buffer;
    let mimeTypeToUpload = file.mimetype;

    if (
      category === 'image' &&
      file.mimetype !== 'image/gif' &&
      compress !== 'false'
    ) {
      const compressed = await this.mediaService.compressImage(
        file.buffer,
        file.mimetype,
      );
      bufferToUpload = compressed.buffer;
      mimeTypeToUpload = compressed.mimeType;
    }

    const { key, url } = await this.mediaService.uploadFileWithKey(
      bufferToUpload,
      mimeTypeToUpload,
      folder || category,
    );

    let thumbnailUrl: string | null = null;
    if (category === 'video') {
      const thumbBuffer = await this.mediaService.generateThumbnail(file.buffer);
      if (thumbBuffer) {
        thumbnailUrl = await this.mediaService.uploadFile(
          thumbBuffer,
          'image/jpeg',
          `${folder || 'videos'}/thumbnails`,
        );
      }
    }

    return {
      key,
      url,
      thumbnailUrl,
      fileName: file.originalname,
      mimeType: mimeTypeToUpload,
      fileSize: bufferToUpload.length,
      category,
    };
  }

  @Get('presigned-url')
  @ApiOperation({ summary: 'Get a temporary presigned URL for an S3 media object' })
  @ApiQuery({ name: 'key', required: true })
  @ApiQuery({ name: 'expiresIn', required: false, type: Number })
  async getPresignedUrl(
    @Query('key') key: string,
    @Query('expiresIn') expiresIn?: string,
  ) {
    const ttl = expiresIn ? parseInt(expiresIn, 10) : 3600;
    if (Number.isNaN(ttl) || ttl <= 0 || ttl > 86400) {
      throw new BadRequestException('expiresIn must be between 1 and 86400 seconds');
    }

    const url = await this.mediaService.getPresignedUrl(key, ttl);
    return { key, url, expiresIn: ttl };
  }

  @Delete()
  @ApiOperation({ summary: 'Delete an uploaded S3 media object by key' })
  @ApiQuery({ name: 'key', required: true })
  async deleteMedia(@Query('key') key: string) {
    await this.mediaService.deleteFile(key);
    return { deleted: true, key };
  }
}

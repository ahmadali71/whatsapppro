import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import sharp = require('sharp');

const execFileAsync = promisify(execFile);

export type MediaCategory = 'image' | 'video' | 'document' | 'voice' | 'audio';

const MAX_FILE_SIZES: Record<MediaCategory, number> = {
  image: 16 * 1024 * 1024, // 16 MB
  voice: 16 * 1024 * 1024, // 16 MB
  audio: 16 * 1024 * 1024, // 16 MB
  video: 100 * 1024 * 1024, // 100 MB
  document: 100 * 1024 * 1024, // 100 MB
};

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly s3Client: S3Client;
  private readonly bucket: string;
  private readonly region: string;
  private readonly publicEndpoint?: string;
  private readonly isS3Configured: boolean;
  private readonly isProduction: boolean;
  private readonly localUploadsRoot: string;

  constructor(private readonly configService: ConfigService) {
    this.region = this.configService.get<string>('AWS_S3_REGION', 'us-east-1');
    this.bucket = this.configService.get<string>('AWS_S3_BUCKET', 'whatsapp-pro-media');
    this.publicEndpoint = this.configService.get<string>('AWS_S3_PUBLIC_URL');
    this.isProduction =
      this.configService.get<string>('NODE_ENV', 'development') === 'production';
    this.localUploadsRoot = process.env.VERCEL
      ? path.join(os.tmpdir(), 'whatsapp-pro-uploads')
      : path.resolve(process.cwd(), 'uploads');

    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID', '').trim();
    const secretAccessKey = this.configService
      .get<string>('AWS_SECRET_ACCESS_KEY', '')
      .trim();
    const endpoint = this.configService.get<string>('AWS_S3_ENDPOINT');

    this.isS3Configured =
      this.isNonPlaceholderCredential(accessKeyId) &&
      this.isNonPlaceholderCredential(secretAccessKey);

    if (!this.isS3Configured && !this.isProduction) {
      this.logger.warn(
        `AWS S3 credentials not configured; using local disk storage fallback at ${this.localUploadsRoot}`,
      );
    }

    this.s3Client = new S3Client({
      region: this.region,
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      ...(this.isS3Configured
        ? { credentials: { accessKeyId, secretAccessKey } }
        : {}),
    });
  }

  private isNonPlaceholderCredential(value: string): boolean {
    if (!value) return false;
    const lower = value.toLowerCase();
    return (
      !lower.startsWith('your-') &&
      !lower.startsWith('your_') &&
      lower !== 'changeme' &&
      lower !== 'placeholder' &&
      lower !== 'replace-me'
    );
  }

  private sanitizeFolder(folder: string): string {
    const cleaned = (folder || 'uploads')
      .replace(/\\/g, '/')
      .split('/')
      .filter((seg) => seg && seg !== '.' && seg !== '..')
      .join('/');
    return cleaned || 'uploads';
  }

  /**
   * Upload a file buffer to S3 (or local disk in non-production dev when S3 is unconfigured)
   * under `folder/{uuid}.{ext}` and return its URL.
   */
  async uploadFile(
    buffer: Buffer,
    mimeType: string,
    folder = 'uploads',
  ): Promise<string> {
    const ext = this.extensionFromMimeType(mimeType);
    const cleanFolder = this.sanitizeFolder(folder);
    const filename = `${uuidv4()}.${ext}`;
    const key = `${cleanFolder}/${filename}`;

    if (!this.isS3Configured) {
      if (this.isProduction) {
        throw new InternalServerErrorException(
          'AWS S3 credentials are required in production',
        );
      }

      const targetDir = path.resolve(this.localUploadsRoot, cleanFolder);
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(path.resolve(targetDir, filename), buffer);
      return `/uploads/${key}`;
    }

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      }),
    );

    if (this.publicEndpoint) {
      return `${this.publicEndpoint.replace(/\/+$/, '')}/${key}`;
    }

    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  /**
   * Upload buffer and return both the storage key and URL.
   */
  async uploadFileWithKey(
    buffer: Buffer,
    mimeType: string,
    folder = 'uploads',
  ): Promise<{ key: string; url: string }> {
    const url = await this.uploadFile(buffer, mimeType, folder);
    const key = this.extractKeyFromUrl(url);
    return { key, url };
  }

  /**
   * Generate a temporary signed GET URL for private S3 objects (or local URL in dev).
   */
  async getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
    if (!key) {
      throw new BadRequestException('S3 object key is required');
    }

    if (!this.isS3Configured && !this.isProduction) {
      const cleanKey = key.replace(/^\/+/, '').replace(/^uploads\//, '');
      return `/uploads/${cleanKey}`;
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(this.s3Client, command, { expiresIn });
  }

  /**
   * Delete an object from S3 (or local disk in dev) by key.
   */
  async deleteFile(key: string): Promise<void> {
    if (!key) {
      throw new BadRequestException('S3 object key is required');
    }

    if (!this.isS3Configured && !this.isProduction) {
      const cleanKey = key.replace(/^\/+/, '').replace(/^uploads\//, '');
      const targetPath = path.resolve(this.localUploadsRoot, cleanKey);
      if (!targetPath.startsWith(this.localUploadsRoot + path.sep)) {
        throw new BadRequestException('Invalid media key');
      }
      await fs.unlink(targetPath).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== 'ENOENT') throw err;
      });
      return;
    }

    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  /**
   * Validate file size against category limits:
   * - images: max 16 MB
   * - voice/audio: max 16 MB
   * - videos: max 100 MB
   * - documents: max 100 MB
   */
  validateFileSize(size: number, type: MediaCategory): boolean {
    const maxBytes = MAX_FILE_SIZES[type];
    if (!maxBytes) {
      throw new BadRequestException(`Unsupported media type: ${type}`);
    }
    if (size <= 0) {
      throw new BadRequestException('File cannot be empty');
    }
    if (size > maxBytes) {
      const maxMb = Math.round(maxBytes / (1024 * 1024));
      throw new BadRequestException(
        `File exceeds maximum allowed size of ${maxMb}MB for ${type}`,
      );
    }
    return true;
  }

  /**
   * Compress and resize an image buffer using sharp.
   */
  async compressImage(buffer: Buffer): Promise<Buffer> {
    return sharp(buffer)
      .rotate()
      .resize({
        width: 2048,
        height: 2048,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer();
  }

  /**
   * Extract a JPEG thumbnail from a video buffer using ffmpeg CLI.
   */
  async generateThumbnail(videoBuffer: Buffer): Promise<Buffer | null> {
    const tmpDir = os.tmpdir();
    const id = uuidv4();
    const inputPath = path.join(tmpDir, `wa-vid-${id}.mp4`);
    const outputPath = path.join(tmpDir, `wa-thumb-${id}.jpg`);

    try {
      await fs.writeFile(inputPath, videoBuffer);

      await execFileAsync('ffmpeg', [
        '-y',
        '-i',
        inputPath,
        '-ss',
        '00:00:01.000',
        '-vframes',
        '1',
        '-vf',
        'scale=480:-1',
        '-q:v',
        '4',
        outputPath,
      ]);

      return await fs.readFile(outputPath);
    } catch (error) {
      this.logger.warn(
        `Video thumbnail generation failed (is ffmpeg installed?): ${(error as Error).message}`,
      );
      return null;
    } finally {
      await Promise.allSettled([
        fs.unlink(inputPath).catch(() => undefined),
        fs.unlink(outputPath).catch(() => undefined),
      ]);
    }
  }

  resolveCategoryFromMime(mimeType: string, explicitType?: string): MediaCategory {
    if (
      explicitType &&
      ['image', 'video', 'document', 'voice', 'audio'].includes(explicitType)
    ) {
      return explicitType as MediaCategory;
    }
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'voice';
    return 'document';
  }

  private extractKeyFromUrl(url: string): string {
    if (url.startsWith('/uploads/')) {
      return url.slice('/uploads/'.length);
    }
    try {
      const parsed = new URL(url);
      return parsed.pathname.replace(/^\/+/, '');
    } catch {
      return url;
    }
  }

  private extensionFromMimeType(mimeType: string): string {
    const map: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/quicktime': 'mov',
      'audio/mpeg': 'mp3',
      'audio/ogg': 'ogg',
      'audio/webm': 'webm',
      'audio/wav': 'wav',
      'audio/aac': 'aac',
      'application/pdf': 'pdf',
      'text/plain': 'txt',
    };

    if (map[mimeType]) {
      return map[mimeType];
    }
    const parts = mimeType.split('/');
    return parts[1]?.split(';')[0] ?? 'bin';
  }
}

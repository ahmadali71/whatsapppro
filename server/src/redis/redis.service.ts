import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;
  private readonly skipConnection: boolean;
  private isConnected = false;
  private lastError: string | null = null;

  constructor(private readonly configService: ConfigService) {
    const configuredUrl = this.configService.get<string>('REDIS_URL')?.trim();
    this.skipConnection = Boolean(process.env.VERCEL) && !configuredUrl;

    if (this.skipConnection) {
      this.lastError = 'REDIS_URL not configured in Vercel environment';
    }

    const redisUrl = configuredUrl || 'redis://localhost:6379';
    const skip = this.skipConnection;
    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: skip ? 0 : 3,
      enableOfflineQueue: !skip,
      retryStrategy(times) {
        if (skip || (process.env.VERCEL && times > 2)) {
          return null;
        }
        return Math.min(times * 100, 3000);
      },
      lazyConnect: true,
    });

    this.client.on('ready', () => {
      this.isConnected = true;
      this.lastError = null;
    });

    this.client.on('close', () => {
      this.isConnected = false;
    });

    this.client.on('error', (err) => {
      this.isConnected = false;
      this.lastError = err.message;
      this.logger.error(`Redis error: ${err.message}`);
    });
  }

  async onModuleInit() {
    if (this.skipConnection) {
      this.logger.warn(
        'REDIS_URL is unset in Vercel environment; skipping Redis connection',
      );
      return;
    }

    try {
      await this.client.connect();
      this.isConnected = true;
      this.lastError = null;
      this.logger.log('Connected to Redis');
    } catch (error) {
      this.isConnected = false;
      this.lastError = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Redis initial connection failed: ${this.lastError}`);
    }
  }

  async onModuleDestroy() {
    if (this.skipConnection || !this.isConnected) {
      return;
    }
    try {
      await this.client.quit();
      this.isConnected = false;
      this.logger.log('Disconnected from Redis');
    } catch (error) {
      this.logger.warn(
        `Error disconnecting from Redis: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  getStatus(): { connected: boolean; error: string | null } {
    return {
      connected: this.isConnected,
      error: this.lastError,
    };
  }

  getClient(): Redis {
    return this.client;
  }

  async ping(): Promise<string> {
    if (this.skipConnection) return 'SKIPPED';
    return this.client.ping();
  }

  async get(key: string): Promise<string | null> {
    if (this.skipConnection) return null;
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<'OK'> {
    if (this.skipConnection) return 'OK';
    if (ttlSeconds !== undefined) {
      return this.client.set(key, value, 'EX', ttlSeconds);
    }
    return this.client.set(key, value);
  }

  async del(key: string): Promise<number> {
    if (this.skipConnection) return 0;
    return this.client.del(key);
  }

  async exists(key: string): Promise<number> {
    if (this.skipConnection) return 0;
    return this.client.exists(key);
  }

  async incr(key: string): Promise<number> {
    if (this.skipConnection) return 0;
    return this.client.incr(key);
  }

  async expire(key: string, ttlSeconds: number): Promise<number> {
    if (this.skipConnection) return 0;
    return this.client.expire(key, ttlSeconds);
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    if (this.skipConnection) return 0;
    return this.client.sadd(key, ...members);
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    if (this.skipConnection) return 0;
    return this.client.srem(key, ...members);
  }

  async smembers(key: string): Promise<string[]> {
    if (this.skipConnection) return [];
    return this.client.smembers(key);
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    if (this.skipConnection) return 0;
    return this.client.hset(key, field, value);
  }

  async hget(key: string, field: string): Promise<string | null> {
    if (this.skipConnection) return null;
    return this.client.hget(key, field);
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    if (this.skipConnection) return 0;
    return this.client.hdel(key, ...fields);
  }

  async publish(channel: string, message: string): Promise<number> {
    if (this.skipConnection) return 0;
    return this.client.publish(channel, message);
  }
}

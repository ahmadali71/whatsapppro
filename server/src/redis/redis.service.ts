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
  private connectingPromise: Promise<boolean> | null = null;

  constructor(private readonly configService: ConfigService) {
    const configuredUrl = this.configService.get<string>('REDIS_URL')?.trim();
    const isVercel = Boolean(process.env.VERCEL);
    this.skipConnection = isVercel && !configuredUrl;

    if (this.skipConnection) {
      this.lastError = 'REDIS_URL not configured in Vercel environment';
    }

    const redisUrl = configuredUrl || 'redis://localhost:6379';
    const skip = this.skipConnection;
    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: skip ? 0 : 3,
      enableOfflineQueue: !skip,
      ...(isVercel ? { connectTimeout: 5000, commandTimeout: 5000 } : {}),
      retryStrategy(times) {
        if (skip) return null;
        if (process.env.VERCEL) {
          return times > 2 ? null : Math.min(times * 100, 1000);
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

    this.client.on('end', () => {
      this.isConnected = false;
    });

    this.client.on('error', (err) => {
      this.isConnected = false;
      this.lastError = err.message;
      this.logger.error(`Redis error: ${err.message}`);
    });
  }

  private async ensureReady(): Promise<boolean> {
    if (this.skipConnection) {
      return false;
    }

    const status = this.client.status;
    if (status === 'ready' || status === 'connect') {
      return true;
    }

    if (status === 'connecting' || status === 'reconnecting') {
      return this.connectingPromise ?? true;
    }

    if (status === 'end' || status === 'close' || status === 'wait') {
      if (!this.connectingPromise) {
        this.connectingPromise = this.client
          .connect()
          .then(() => {
            this.isConnected = true;
            this.lastError = null;
            return true;
          })
          .catch((error: unknown) => {
            this.isConnected = false;
            this.lastError = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Redis reconnect failed: ${this.lastError}`);
            return false;
          })
          .finally(() => {
            this.connectingPromise = null;
          });
      }
      return this.connectingPromise;
    }

    return false;
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
    if (!(await this.ensureReady())) return 'SKIPPED';
    return this.client.ping();
  }

  async get(key: string): Promise<string | null> {
    if (!(await this.ensureReady())) return null;
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<'OK'> {
    if (!(await this.ensureReady())) return 'OK';
    if (ttlSeconds !== undefined) {
      return this.client.set(key, value, 'EX', ttlSeconds);
    }
    return this.client.set(key, value);
  }

  async del(key: string): Promise<number> {
    if (!(await this.ensureReady())) return 0;
    return this.client.del(key);
  }

  async exists(key: string): Promise<number> {
    if (!(await this.ensureReady())) return 0;
    return this.client.exists(key);
  }

  async incr(key: string): Promise<number> {
    if (!(await this.ensureReady())) return 0;
    return this.client.incr(key);
  }

  async expire(key: string, ttlSeconds: number): Promise<number> {
    if (!(await this.ensureReady())) return 0;
    return this.client.expire(key, ttlSeconds);
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    if (!(await this.ensureReady())) return 0;
    return this.client.sadd(key, ...members);
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    if (!(await this.ensureReady())) return 0;
    return this.client.srem(key, ...members);
  }

  async smembers(key: string): Promise<string[]> {
    if (!(await this.ensureReady())) return [];
    return this.client.smembers(key);
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    if (!(await this.ensureReady())) return 0;
    return this.client.hset(key, field, value);
  }

  async hget(key: string, field: string): Promise<string | null> {
    if (!(await this.ensureReady())) return null;
    return this.client.hget(key, field);
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    if (!(await this.ensureReady())) return 0;
    return this.client.hdel(key, ...fields);
  }

  async publish(channel: string, message: string): Promise<number> {
    if (!(await this.ensureReady())) return 0;
    return this.client.publish(channel, message);
  }

  async rpush(key: string, ...values: string[]): Promise<number> {
    if (values.length === 0 || !(await this.ensureReady())) return 0;
    return this.client.rpush(key, ...values);
  }

  async lrangeAndDel(key: string): Promise<string[]> {
    if (!(await this.ensureReady())) return [];
    const results = await this.client.multi().lrange(key, 0, -1).del(key).exec();
    if (!results || !results[0]) return [];
    const [err, items] = results[0];
    if (err || !Array.isArray(items)) return [];
    return items as string[];
  }
}

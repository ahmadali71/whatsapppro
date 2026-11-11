import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private isConnected = false;
  private lastError: string | null = null;

  constructor() {
    super({
      log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
    });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.isConnected = true;
      this.lastError = null;
      this.logger.log('Connected to PostgreSQL via Prisma');
    } catch (error) {
      this.isConnected = false;
      this.lastError = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to connect to PostgreSQL via Prisma: ${this.lastError}`);
    }
  }

  async onModuleDestroy() {
    if (!this.isConnected) {
      return;
    }
    try {
      await this.$disconnect();
      this.isConnected = false;
      this.logger.log('Disconnected from PostgreSQL');
    } catch (error) {
      this.logger.warn(
        `Error disconnecting from PostgreSQL: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  getStatus(): { connected: boolean; error: string | null } {
    return {
      connected: this.isConnected,
      error: this.lastError,
    };
  }
}

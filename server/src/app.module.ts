import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { OtpModule } from './otp/otp.module';
import { UsersModule } from './users/users.module';
import { KeysModule } from './keys/keys.module';
import { ChatsModule } from './chats/chats.module';
import { GatewayModule } from './gateway/gateway.module';
import { MediaModule } from './media/media.module';
import { CallsModule } from './calls/calls.module';
import { GroupsModule } from './groups/groups.module';
import { CommunitiesModule } from './communities/communities.module';
import { NotificationsModule } from './notifications/notifications.module';
import { StatusesModule } from './statuses/statuses.module';
import { PrivacyModule } from './privacy/privacy.module';
import { SearchModule } from './search/search.module';
import { SettingsModule } from './settings/settings.module';
import { AdminModule } from './admin/admin.module';
import { ReportsModule } from './reports/reports.module';
import { TasksModule } from './tasks/tasks.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
    PrismaModule,
    RedisModule,
    AuthModule,
    OtpModule,
    UsersModule,
    KeysModule,
    ChatsModule,
    GatewayModule,
    MediaModule,
    CallsModule,
    GroupsModule,
    CommunitiesModule,
    NotificationsModule,
    StatusesModule,
    PrivacyModule,
    SearchModule,
    SettingsModule,
    AdminModule,
    ReportsModule,
    TasksModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}

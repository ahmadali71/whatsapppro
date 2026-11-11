import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ChatGateway } from './chat.gateway';
import { GatewayService } from './gateway.service';
import { ChatsModule } from '../chats/chats.module';

@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET', 'dev-jwt-secret'),
      }),
    }),
    forwardRef(() => ChatsModule),
  ],
  providers: [GatewayService, ChatGateway],
  exports: [GatewayService, ChatGateway],
})
export class GatewayModule {}

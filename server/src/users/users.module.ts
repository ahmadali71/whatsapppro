import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OtpModule } from '../otp/otp.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule, OtpModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}

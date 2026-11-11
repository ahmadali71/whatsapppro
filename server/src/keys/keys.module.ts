import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { KeysController } from './keys.controller';
import { KeysService } from './keys.service';

@Module({
  imports: [AuthModule],
  controllers: [KeysController],
  providers: [KeysService],
  exports: [KeysService],
})
export class KeysModule {}

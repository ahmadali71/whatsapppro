import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrivacyModule } from '../privacy/privacy.module';
import { StatusesModule } from '../statuses/statuses.module';
import { TasksService } from './tasks.service';

@Module({
  imports: [ScheduleModule.forRoot(), StatusesModule, PrivacyModule],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}

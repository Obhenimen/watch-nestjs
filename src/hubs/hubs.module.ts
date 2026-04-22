import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Hub } from './entities/hub.entity';
import { HubFollow } from './entities/hub-follow.entity';
import { HubsController } from './hubs.controller';
import { HubsService } from './hubs.service';
import { PostsModule } from '../posts/posts.module';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([Hub, HubFollow]),
    forwardRef(() => PostsModule),
  ],
  controllers: [HubsController],
  providers: [HubsService],
  exports: [TypeOrmModule, HubsService],
})
export class HubsModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Post } from './entities/post.entity';
import { Like } from './entities/post-like.entity';
import { Repost } from './entities/repost.entity';
import { Hub } from '../hubs/entities/hub.entity';
import { HubFollow } from '../hubs/entities/hub-follow.entity';
import { Comment } from '../comments/entities/comment.entity';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';

@Module({
  imports: [
    AuthModule,
    NotificationsModule,
    TypeOrmModule.forFeature([Post, Like, Repost, Hub, HubFollow, Comment]),
  ],
  controllers: [PostsController],
  providers: [PostsService],
  exports: [TypeOrmModule, PostsService],
})
export class PostsModule {}

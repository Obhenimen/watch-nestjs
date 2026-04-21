import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Post } from './entities/post.entity';
import { PostMedia } from './entities/post-media.entity';
import { PostLike } from './entities/post-like.entity';
import { Hub } from '../hubs/entities/hub.entity';
import { Comment } from '../comments/entities/comment.entity';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([Post, PostMedia, PostLike, Hub, Comment]),
  ],
  controllers: [PostsController],
  providers: [PostsService],
  exports: [TypeOrmModule, PostsService],
})
export class PostsModule {}

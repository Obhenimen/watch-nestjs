import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Comment } from './entities/comment.entity';
import { CommentLike } from './entities/comment-like.entity';
import { Post } from '../posts/entities/post.entity';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([Comment, CommentLike, Post])],
  controllers: [CommentsController],
  providers: [CommentsService],
  exports: [TypeOrmModule, CommentsService],
})
export class CommentsModule {}

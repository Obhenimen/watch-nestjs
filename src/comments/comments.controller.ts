import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

@UseGuards(JwtAuthGuard)
@Controller()
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  /**
   * POST /posts/:postId/comments
   * Creates a top-level comment or a reply (supply parentCommentId in body).
   */
  @Post('posts/:postId/comments')
  createComment(
    @Param('postId', ParseUUIDPipe) postId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateCommentDto,
  ) {
    return this.commentsService.create(postId, user, dto);
  }

  /**
   * GET /posts/:postId/comments
   * Returns paginated top-level comments for a post.
   */
  @Get('posts/:postId/comments')
  getComments(
    @Param('postId', ParseUUIDPipe) postId: string,
    @CurrentUser() user: User,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.commentsService.findByPost(
      postId,
      user.id,
      limit ? parseInt(limit, 10) : 20,
      offset ? parseInt(offset, 10) : 0,
    );
  }

  /**
   * GET /comments/:id/replies
   * Returns paginated direct replies to a comment.
   */
  @Get('comments/:id/replies')
  getReplies(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.commentsService.findReplies(
      id,
      user.id,
      limit ? parseInt(limit, 10) : 20,
      offset ? parseInt(offset, 10) : 0,
    );
  }

  /**
   * POST /comments/:id/like
   * Toggles a like on a comment. Returns new liked state and like count.
   */
  @Post('comments/:id/like')
  @HttpCode(HttpStatus.OK)
  toggleLike(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.commentsService.toggleLike(id, user.id);
  }

  /**
   * DELETE /comments/:id
   * Soft-deletes a comment. Only the author may delete their own comment.
   */
  @Delete('comments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeComment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.commentsService.remove(id, user.id);
  }
}

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
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

@ApiTags('Comments')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller()
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Post('posts/:postId/comments')
  createComment(
    @Param('postId', ParseUUIDPipe) postId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateCommentDto,
  ) {
    return this.commentsService.create(postId, user, dto);
  }

  @Get('posts/:postId/comments')
  @ApiQuery({ name: 'limit',  required: false, example: 20 })
  @ApiQuery({ name: 'cursor', required: false })
  getComments(
    @Param('postId', ParseUUIDPipe) postId: string,
    @CurrentUser() user: User,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.commentsService.findByPost(
      postId,
      user.id,
      limit ? parseInt(limit, 10) : 20,
      cursor,
    );
  }

  @Get('comments/:id/replies')
  @ApiQuery({ name: 'limit',  required: false, example: 20 })
  @ApiQuery({ name: 'cursor', required: false })
  getReplies(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.commentsService.findReplies(
      id,
      user.id,
      limit ? parseInt(limit, 10) : 20,
      cursor,
    );
  }

  @Post('comments/:id/like')
  @HttpCode(HttpStatus.OK)
  toggleLike(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.commentsService.toggleLike(id, user.id);
  }

  @Delete('comments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeComment(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.commentsService.remove(id, user.id);
  }
}

import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { PostsService } from './posts.service';
import { CreatePostDto } from './dto/create-post.dto';
import { FeedQueryDto } from './dto/feed-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { postMediaMulterOptions } from '../common/multer/multer.config';

@Controller('posts')
@UseGuards(JwtAuthGuard)
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  /**
   * GET /posts/feed
   * Returns the personalised "For You" feed for the authenticated user.
   * Ranked by engagement score weighted by recency.
   */
  @Get('feed')
  getFeed(@CurrentUser() user: User, @Query() query: FeedQueryDto) {
    return this.postsService.getFeed(user, query);
  }

  /**
   * POST /posts
   * Creates a new post, optionally with images/videos attached.
   * Accepts multipart/form-data: fields = CreatePostDto, files = media (key: "media").
   */
  @Post()
  @UseInterceptors(FilesInterceptor('media', 10, postMediaMulterOptions))
  createPost(
    @CurrentUser() user: User,
    @Body() dto: CreatePostDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.postsService.create(user, dto, files ?? []);
  }

  /**
   * GET /posts/:id
   * Returns a single post with its author, hub, and media.
   * Also increments the view count.
   */
  @Get(':id')
  getPost(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.postsService.findById(id, user.id);
  }

  /**
   * POST /posts/:id/like
   * Toggles a like on the post. Returns the new liked state and like count.
   */
  @Post(':id/like')
  @HttpCode(HttpStatus.OK)
  toggleLike(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.postsService.toggleLike(id, user.id);
  }

  /**
   * DELETE /posts/:id
   * Soft-deletes the post. Only the author may delete their own post.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removePost(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.postsService.remove(id, user.id);
  }
}

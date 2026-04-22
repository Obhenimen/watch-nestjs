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
  UploadedFile,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { PostsService } from './posts.service';
import { CreatePostDto } from './dto/create-post.dto';
import { FeedQueryDto } from './dto/feed-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { postMediaMulterOptions } from '../common/multer/multer.config';

@ApiTags('Posts')
@ApiBearerAuth('access-token')
@Controller('posts')
@UseGuards(JwtAuthGuard)
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get('feed')
  getFeed(@CurrentUser() user: User, @Query() query: FeedQueryDto) {
    return this.postsService.getFeed(user, query);
  }

  @Post()
  @UseInterceptors(FileInterceptor('media', postMediaMulterOptions))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        hubId:      { type: 'string', format: 'uuid' },
        title:      { type: 'string' },
        body:       { type: 'string' },
        hasSpoiler: { type: 'boolean' },
        media:      { type: 'string', format: 'binary' },
      },
      required: ['hubId', 'body'],
    },
  })
  createPost(
    @CurrentUser() user: User,
    @Body() dto: CreatePostDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.postsService.create(user, dto, file);
  }

  @Get(':id')
  getPost(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.postsService.findById(id, user.id);
  }

  @Post(':id/like')
  @HttpCode(HttpStatus.OK)
  toggleLike(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.postsService.toggleLike(id, user.id);
  }

  @Post(':id/repost')
  @HttpCode(HttpStatus.OK)
  toggleRepost(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.postsService.toggleRepost(id, user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removePost(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.postsService.remove(id, user.id);
  }
}

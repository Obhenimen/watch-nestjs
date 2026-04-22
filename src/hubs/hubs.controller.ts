import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { HubsService } from './hubs.service';
import { PostsService } from '../posts/posts.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

@ApiTags('Hubs')
@ApiBearerAuth('access-token')
@Controller('hubs')
@UseGuards(JwtAuthGuard)
export class HubsController {
  constructor(
    private readonly hubsService: HubsService,
    private readonly postsService: PostsService,
  ) {}

  @Get()
  @ApiQuery({ name: 'sort',   required: false, enum: ['trending', 'new', 'top'], example: 'trending' })
  @ApiQuery({ name: 'limit',  required: false, example: 20 })
  @ApiQuery({ name: 'cursor', required: false, description: 'ISO-8601 timestamp from previous page (only used when sort=new)' })
  findAll(
    @Query('sort') sort?: 'trending' | 'new' | 'top',
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.hubsService.findAll(sort ?? 'trending', limit ? parseInt(limit, 10) : 20, cursor);
  }

  @Get('search')
  @ApiQuery({ name: 'q',     required: true,  example: 'dune' })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  search(@Query('q') q: string, @Query('limit') limit?: string) {
    return this.hubsService.search(q ?? '', limit ? parseInt(limit, 10) : 20);
  }

  @Get('followed')
  getFollowed(@CurrentUser() user: User) {
    return this.hubsService.getFollowedHubs(user.id);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.hubsService.findById(id, user.id);
  }

  @Get(':id/posts')
  @ApiQuery({ name: 'sort',   required: false, enum: ['new', 'top', 'trending'], example: 'new' })
  @ApiQuery({ name: 'limit',  required: false, example: 20 })
  @ApiQuery({ name: 'cursor', required: false })
  getHubPosts(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Query('sort') sort?: 'new' | 'top' | 'trending',
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.postsService.getHubPosts(
      id,
      user.id,
      sort ?? 'new',
      limit ? parseInt(limit, 10) : 20,
      cursor,
    );
  }

  @Post(':id/follow')
  @HttpCode(HttpStatus.OK)
  toggleFollow(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.hubsService.toggleFollow(id, user.id);
  }
}

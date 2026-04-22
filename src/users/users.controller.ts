import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiConsumes, ApiBody, ApiQuery } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from './entities/user.entity';
import { UpdateUserDto } from './dto/update-user.dto';
import { avatarMulterOptions } from '../common/multer/multer.config';

@ApiTags('Users')
@ApiBearerAuth('access-token')
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMyProfile(@CurrentUser() user: User) {
    return this.usersService.getProfile(user.id, user.id);
  }

  @Patch('me')
  @UseInterceptors(FileInterceptor('avatar', avatarMulterOptions))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        displayName: { type: 'string', maxLength: 60 },
        username:    { type: 'string', minLength: 3, maxLength: 30 },
        bio:         { type: 'string', maxLength: 500 },
        avatar:      { type: 'string', format: 'binary' },
      },
    },
  })
  updateMyProfile(
    @CurrentUser() user: User,
    @Body() dto: UpdateUserDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.usersService.updateProfile(user.id, dto, file);
  }

  @Get(':id')
  getProfile(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.usersService.getProfile(id, user.id);
  }

  @Get(':id/posts')
  @ApiQuery({ name: 'limit',  required: false, example: 20 })
  @ApiQuery({ name: 'cursor', required: false })
  getUserPosts(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.usersService.getUserPosts(id, limit ? parseInt(limit, 10) : 20, cursor);
  }

  @Post(':id/follow')
  @HttpCode(HttpStatus.OK)
  toggleFollow(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.usersService.toggleFollow(id, user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: User,
  ) {
    if (currentUser.id !== id) throw new ForbiddenException('You can only delete your own account');
    await this.usersService.remove(id);
    return { message: 'Account deleted successfully' };
  }
}

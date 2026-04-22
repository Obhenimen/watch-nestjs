import { Controller, Get, Post, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

@ApiTags('Notifications')
@ApiBearerAuth('access-token')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiQuery({ name: 'limit',  required: false, example: 20 })
  @ApiQuery({ name: 'cursor', required: false })
  getNotifications(
    @CurrentUser() user: User,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.notificationsService.getForUser(
      user.id,
      limit ? parseInt(limit, 10) : 20,
      cursor,
    );
  }

  @Get('unread-count')
  getUnreadCount(@CurrentUser() user: User) {
    return this.notificationsService.getUnreadCount(user.id).then((count) => ({ count }));
  }

  @Post('read')
  @HttpCode(HttpStatus.OK)
  markAllRead(@CurrentUser() user: User) {
    return this.notificationsService.markAllRead(user.id).then(() => ({ ok: true }));
  }
}

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
import { ListsService } from './lists.service';
import { CreateListDto } from './dto/create-list.dto';
import { AddListItemDto } from './dto/add-list-item.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

@ApiTags('Lists')
@ApiBearerAuth('access-token')
@Controller('lists')
@UseGuards(JwtAuthGuard)
export class ListsController {
  constructor(private readonly listsService: ListsService) {}

  @Get()
  getUserLists(@CurrentUser() user: User) {
    return this.listsService.getUserLists(user.id);
  }

  @Post()
  createList(@CurrentUser() user: User, @Body() dto: CreateListDto) {
    return this.listsService.createList(user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteList(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.listsService.deleteList(id, user.id);
  }

  @Get(':id/items')
  @ApiQuery({ name: 'limit',  required: false, example: 20 })
  @ApiQuery({ name: 'cursor', required: false })
  getListItems(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.listsService.getListItems(
      id,
      user.id,
      limit ? parseInt(limit, 10) : 20,
      cursor,
    );
  }

  @Post(':id/items')
  addItem(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body() dto: AddListItemDto,
  ) {
    return this.listsService.addItem(id, user.id, dto);
  }

  @Delete(':id/items/:hubId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('hubId', ParseUUIDPipe) hubId: string,
    @CurrentUser() user: User,
  ) {
    return this.listsService.removeItem(id, hubId, user.id);
  }
}

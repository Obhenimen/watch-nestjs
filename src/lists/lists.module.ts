import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { List } from './entities/list.entity';
import { ListItem } from './entities/list-item.entity';
import { Hub } from '../hubs/entities/hub.entity';
import { ListsController } from './lists.controller';
import { ListsService } from './lists.service';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([List, ListItem, Hub])],
  controllers: [ListsController],
  providers: [ListsService],
  exports: [TypeOrmModule, ListsService],
})
export class ListsModule {}

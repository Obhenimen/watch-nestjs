import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Hub } from './entities/hub.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Hub])],
  exports: [TypeOrmModule],
})
export class HubsModule {}

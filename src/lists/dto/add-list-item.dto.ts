import { IsUUID, IsOptional, IsIn } from 'class-validator';

export class AddListItemDto {
  @IsUUID()
  hubId: string;

  @IsOptional()
  @IsIn(['watching', 'watch_next'])
  status?: 'watching' | 'watch_next';
}

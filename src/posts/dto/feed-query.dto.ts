import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';

export class FeedQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  @Transform(({ value }: { value: unknown }) => (value ? parseInt(String(value), 10) : 20))
  limit?: number = 20;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Transform(({ value }: { value: unknown }) => (value ? parseInt(String(value), 10) : 0))
  offset?: number = 0;
}

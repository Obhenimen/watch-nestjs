import {
  IsString,
  IsNotEmpty,
  IsBoolean,
  IsOptional,
  MaxLength,
  IsUUID,
  IsIn,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreatePostDto {
  @IsUUID()
  hubId: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  title?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  body: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  hasSpoiler?: boolean;
}

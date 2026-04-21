import { IsString, IsNotEmpty, IsBoolean, IsOptional, MaxLength, IsUUID, IsUrl } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreatePostDto {
  @IsUUID()
  hubId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content: string;

  /**
   * Multipart form data sends booleans as strings ("true"/"false").
   * Transform converts the string to an actual boolean before validation.
   */
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  hasSpoiler?: boolean = false;

  /** YouTube watch URL for the hub's trailer or a related clip */
  @IsOptional()
  @IsUrl()
  youtubeUrl?: string;
}

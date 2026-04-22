import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  // letters, numbers, dot, underscore — common username charset
  @Matches(/^[a-zA-Z0-9._]+$/, {
    message:
      'Username can only contain letters, numbers, dots, and underscores.',
  })
  username?: string;

  @IsOptional()
  // Bio can be explicitly cleared by sending an empty string.
  @ValidateIf((o: UpdateUserDto) => o.bio !== null)
  @IsString()
  @MaxLength(500)
  bio?: string | null;
}

import {
  IsEmail,
  IsString,
  MinLength,
  IsOptional,
  IsArray,
  ArrayMinSize,
  IsNumber,
  IsUrl,
  Matches,
} from 'class-validator';

export class SignupDto {
  // ── Step 1: Account ────────────────────────────────────────────────────
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  // ── Step 2: Profile ────────────────────────────────────────────────────
  @IsString()
  @Matches(/^@?[a-zA-Z0-9_]{3,30}$/, {
    message: 'Username may only contain letters, numbers and underscores (3–30 chars)',
  })
  username: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsUrl()
  profilePictureUrl?: string;

  // ── Step 3: Genres (min 3) ─────────────────────────────────────────────
  @IsArray()
  @ArrayMinSize(3, { message: 'Please select at least 3 genres' })
  @IsString({ each: true })
  genres: string[];

  // ── Step 4: Watched movies (min 1) ─────────────────────────────────────
  @IsArray()
  @ArrayMinSize(1, { message: 'Please select at least 1 movie' })
  @IsNumber({}, { each: true })
  watchedMovieIds: number[];
}

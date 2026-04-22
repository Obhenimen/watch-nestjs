import {
  IsEmail,
  IsString,
  MinLength,
  IsOptional,
  IsUrl,
  Matches,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class SignupDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @Matches(/^@?[a-zA-Z0-9_]{3,30}$/, {
    message: 'Username may only contain letters, numbers and underscores (3–30 chars)',
  })
  username: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  displayName: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  bio?: string;

  @IsOptional()
  @IsUrl()
  avatarUrl?: string;
}

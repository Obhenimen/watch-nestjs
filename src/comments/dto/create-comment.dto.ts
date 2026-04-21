import { IsString, IsNotEmpty, IsBoolean, IsOptional, MaxLength, IsUUID } from 'class-validator';

export class CreateCommentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content: string;

  @IsOptional()
  @IsBoolean()
  hasSpoiler?: boolean = false;

  /** Supply to make this comment a reply to another comment */
  @IsOptional()
  @IsUUID()
  parentCommentId?: string;
}

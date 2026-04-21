import {
  Entity,
  PrimaryColumn,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Comment } from './comment.entity';

/**
 * CommentLike — junction table tracking which users liked which comments.
 * Composite PK (userId + commentId) prevents double-likes at the DB level.
 */
@Entity('comment_likes')
export class CommentLike {
  @PrimaryColumn({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @PrimaryColumn({ name: 'comment_id' })
  commentId: string;

  @ManyToOne(() => Comment, (c) => c.likes, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'comment_id' })
  comment: Comment;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

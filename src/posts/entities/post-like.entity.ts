import {
  Entity,
  PrimaryColumn,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Post } from './post.entity';

/**
 * PostLike — junction table tracking which users have liked which posts.
 *
 * Composite primary key (userId + postId) enforces one-like-per-user-per-post
 * at the database level — no application-side duplicate check needed.
 *
 * Like signals feed directly into the recommendation engine:
 * a like on a Hub's post increases that Hub's weight in the user's interest graph.
 */
@Entity('post_likes')
export class PostLike {
  @PrimaryColumn({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @PrimaryColumn({ name: 'post_id' })
  postId: string;

  @ManyToOne(() => Post, (post) => post.likes, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'post_id' })
  post: Post;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

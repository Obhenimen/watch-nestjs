import { Entity, PrimaryColumn, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Post } from './post.entity';

@Entity('reposts')
export class Repost {
  @PrimaryColumn({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @PrimaryColumn({ name: 'post_id' })
  postId: string;

  @ManyToOne(() => Post, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'post_id' })
  post: Post;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

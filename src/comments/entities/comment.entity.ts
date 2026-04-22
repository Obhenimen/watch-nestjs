import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Post } from '../../posts/entities/post.entity';

@Entity('comments')
export class Comment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'post_id' })
  postId: string;

  @ManyToOne(() => Post, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'post_id' })
  post: Post;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'user_id' })
  author: User;

  @Column({ name: 'parent_id', nullable: true, type: 'varchar' })
  parentId: string | null;

  @ManyToOne(() => Comment, { nullable: true, onDelete: 'SET NULL', eager: false })
  @JoinColumn({ name: 'parent_id' })
  parent: Comment | null;

  @Column({ type: 'text' })
  body: string;

  @Column({ name: 'likes_count', default: 0 })
  likesCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'updated_at', nullable: true, type: 'text' })
  updatedAt: string | null;
}

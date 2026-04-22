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
import { Comment } from '../../comments/entities/comment.entity';
import { Hub } from '../../hubs/entities/hub.entity';

export type NotificationType =
  | 'post_like'
  | 'post_repost'
  | 'post_comment'
  | 'comment_reply'
  | 'comment_like'
  | 'user_follow';

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'recipient_id' })
  recipientId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'recipient_id' })
  recipient: User;

  @Column({ name: 'actor_id' })
  actorId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'actor_id' })
  actor: User;

  @Column({ type: 'varchar', length: 30 })
  type: NotificationType;

  @Column({ nullable: true, name: 'post_id', type: 'varchar' })
  postId: string | null;

  @ManyToOne(() => Post, { nullable: true, onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'post_id' })
  post: Post | null;

  @Column({ nullable: true, name: 'comment_id', type: 'varchar' })
  commentId: string | null;

  @ManyToOne(() => Comment, { nullable: true, onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'comment_id' })
  comment: Comment | null;

  @Column({ nullable: true, name: 'hub_id', type: 'varchar' })
  hubId: string | null;

  @ManyToOne(() => Hub, { nullable: true, onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'hub_id' })
  hub: Hub | null;

  @Column({ name: 'is_read', default: false })
  isRead: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

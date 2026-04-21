import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Post } from '../../posts/entities/post.entity';
import { CommentLike } from './comment-like.entity';

/**
 * Comment — supports infinite nesting through a self-referential FK.
 *
 * Tree structure:
 *   parentCommentId = null   → top-level comment on a Post
 *   parentCommentId = <id>   → reply to another comment
 *
 * The `depth` field records how deep the comment sits (0 = top-level,
 * 1 = reply to comment, 2 = reply to reply …). The API enforces a max depth
 * of 3 so threads stay readable; deeper replies are flattened.
 *
 * Soft delete (isDeleted) keeps the row so child replies are not orphaned —
 * the client renders deleted comments as "Comment removed."
 *
 * Relationships:
 *   Comment  >──  User     (author)
 *   Comment  >──  Post     (parent post)
 *   Comment  >──  Comment  (parentComment, nullable)
 *   Comment  ──<  Comment  (replies — direct children)
 *   Comment  ──<  CommentLike
 */
@Entity('comments')
export class Comment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ── Parent post ───────────────────────────────────────────────────────────

  @Column({ name: 'post_id' })
  postId: string;

  @ManyToOne(() => Post, (post) => post.comments, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'post_id' })
  post: Post;

  // ── Author ────────────────────────────────────────────────────────────────

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'user_id' })
  author: User;

  // ── Nesting ───────────────────────────────────────────────────────────────

  /** null → top-level comment; non-null → reply to another comment */
  @Column({ name: 'parent_comment_id', nullable: true, type: 'varchar' })
  parentCommentId: string | null;

  @ManyToOne(() => Comment, (c) => c.replies, {
    nullable: true,
    onDelete: 'SET NULL',
    eager: false,
  })
  @JoinColumn({ name: 'parent_comment_id' })
  parentComment: Comment | null;

  @OneToMany(() => Comment, (c) => c.parentComment, { eager: false })
  replies: Comment[];

  /** 0 = top-level, 1 = reply to a comment, 2 = reply to a reply (max enforced by service) */
  @Column({ default: 0 })
  depth: number;

  // ── Content ───────────────────────────────────────────────────────────────

  @Column({ type: 'text' })
  content: string;

  /** When true the comment body is blurred behind a spoiler badge */
  @Column({ default: false, name: 'has_spoiler' })
  hasSpoiler: boolean;

  // ── Engagement counts (denormalized) ─────────────────────────────────────

  @Column({ default: 0, name: 'like_count' })
  likeCount: number;

  /** Number of direct child comments — incremented when a reply is added */
  @Column({ default: 0, name: 'reply_count' })
  replyCount: number;

  // ── Flags ─────────────────────────────────────────────────────────────────

  /** Soft-deleted comments show as "Comment removed." — children are preserved */
  @Column({ default: false, name: 'is_deleted' })
  isDeleted: boolean;

  // ── Relations ─────────────────────────────────────────────────────────────

  @OneToMany(() => CommentLike, (like) => like.comment, { eager: false })
  likes: CommentLike[];

  // ── Timestamps ────────────────────────────────────────────────────────────

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

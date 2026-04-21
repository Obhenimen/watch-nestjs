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
import { Hub } from '../../hubs/entities/hub.entity';
import { PostMedia } from './post-media.entity';
import { PostLike } from './post-like.entity';
import { Comment } from '../../comments/entities/comment.entity';

/**
 * Post — the core content unit.
 *
 * Relationships:
 *   Post  >──  User   (author)
 *   Post  >──  Hub    (the movie/show being discussed)
 *   Post  ──<  PostMedia   (images and short videos attached to the post)
 *   Post  ──<  PostLike    (which users liked it)
 *   Post  ──<  Comment     (all comments on the post)
 *
 * Engagement fields (likeCount, commentCount, repostCount, viewCount) are
 * denormalized for fast feed queries. They are updated directly in the service
 * to avoid expensive COUNT(*) joins on every feed load.
 */
@Entity('posts')
export class Post {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ── Author ────────────────────────────────────────────────────────────────

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'user_id' })
  author: User;

  // ── Hub (movie / show context) ────────────────────────────────────────────

  @Column({ name: 'hub_id' })
  hubId: string;

  @ManyToOne(() => Hub, (hub) => hub.posts, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'hub_id' })
  hub: Hub;

  // ── Content ───────────────────────────────────────────────────────────────

  @Column()
  title: string;

  @Column({ type: 'text' })
  content: string;

  /** When true the feed card blurs the content until the viewer opts in */
  @Column({ default: false, name: 'has_spoiler' })
  hasSpoiler: boolean;

  /**
   * Optional YouTube trailer / clip URL for the hub's movie or show.
   * e.g. "https://www.youtube.com/watch?v=Way9Dexny3w"
   * The mobile client renders a thumbnail + play button when this is set.
   */
  @Column({ nullable: true, name: 'youtube_url', type: 'text' })
  youtubeUrl: string | null;

  // ── Media ─────────────────────────────────────────────────────────────────

  /** Images and short videos uploaded with this post */
  @OneToMany(() => PostMedia, (m) => m.post, { cascade: true, eager: false })
  media: PostMedia[];

  // ── Engagement counts (denormalized) ────────────────────────────────────

  @Column({ default: 0, name: 'like_count' })
  likeCount: number;

  @Column({ default: 0, name: 'comment_count' })
  commentCount: number;

  @Column({ default: 0, name: 'repost_count' })
  repostCount: number;

  /** Incremented each time the full post detail view is loaded */
  @Column({ default: 0, name: 'view_count' })
  viewCount: number;

  // ── Server-managed flags ─────────────────────────────────────────────────

  /**
   * Set by a background job when engagement score crosses a threshold.
   * Shown as "Trending discussion" on the feed card.
   */
  @Column({ default: false, name: 'is_hot' })
  isHot: boolean;

  /** Moderator-pinned inside the hub — always appears at the top */
  @Column({ default: false, name: 'is_pinned' })
  isPinned: boolean;

  /**
   * Soft delete — the row is kept so reply chains stay intact.
   * Deleted posts render as "This post has been removed."
   */
  @Column({ default: false, name: 'is_deleted' })
  isDeleted: boolean;

  // ── Relations ─────────────────────────────────────────────────────────────

  @OneToMany(() => PostLike, (like) => like.post, { eager: false })
  likes: PostLike[];

  @OneToMany(() => Comment, (c) => c.post, { eager: false })
  comments: Comment[];

  // ── Timestamps ────────────────────────────────────────────────────────────

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

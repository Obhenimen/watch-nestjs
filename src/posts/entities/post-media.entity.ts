import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { Post } from './post.entity';

/**
 * PostMedia — one row per file attached to a Post.
 *
 * Supports both images and short videos. The `url` field holds the
 * server-relative path served under /uploads (e.g. /uploads/posts/abc.mp4).
 * The client prepends EXPO_PUBLIC_API_URL to build the full URL.
 */
@Entity('post_media')
export class PostMedia {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ── Parent post ───────────────────────────────────────────────────────────

  @Column({ name: 'post_id' })
  postId: string;

  @ManyToOne(() => Post, (post) => post.media, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'post_id' })
  post: Post;

  // ── File metadata ─────────────────────────────────────────────────────────

  /** Server-relative URL, e.g. /uploads/posts/1713212345-photo.jpg */
  @Column({ type: 'text' })
  url: string;

  /** "image" | "video" — determines how the client renders the media item */
  @Column({ type: 'varchar', length: 10 })
  type: 'image' | 'video';

  /** MIME type stored for Content-Type headers, e.g. "video/mp4" */
  @Column({ nullable: true, name: 'mime_type', type: 'varchar', length: 50 })
  mimeType: string | null;

  /** File size in bytes — used for upload limit enforcement */
  @Column({ nullable: true, name: 'size_bytes', type: 'integer' })
  sizeBytes: number | null;

  /** Duration in seconds for videos — shown in the feed card player */
  @Column({ nullable: true, name: 'duration_seconds', type: 'real' })
  durationSeconds: number | null;

  /**
   * Auto-generated thumbnail URL for videos.
   * Populated by a background job after the video is processed.
   */
  @Column({ nullable: true, name: 'thumbnail_url', type: 'text' })
  thumbnailUrl: string | null;

  /** Display order within the post's media carousel (0-based) */
  @Column({ default: 0, name: 'display_order' })
  displayOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

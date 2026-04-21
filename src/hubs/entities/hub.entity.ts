import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Post } from '../../posts/entities/post.entity';

/**
 * Hub — one per movie or TV show.
 * Every Post lives inside a Hub. The Hub's tmdbId links it to TMDB metadata
 * (poster, backdrop, genres) so the recommendation engine can correlate a
 * user's engagement with specific titles and genres.
 */
@Entity('hubs')
export class Hub {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Human-readable title, e.g. "Dune: Part Two" */
  @Column({ unique: true })
  name: string;

  /** URL-safe slug, e.g. "dune-part-two" */
  @Column({ unique: true })
  slug: string;

  @Column({ nullable: true, type: 'text' })
  description: string | null;

  /** "movie" or "tv" — drives TMDB API calls and recommendation logic */
  @Column({ type: 'varchar', length: 10 })
  type: 'movie' | 'tv';

  /** The Movie Database ID — used to fetch poster/metadata and for rec engine */
  @Column({ nullable: true, name: 'tmdb_id', type: 'integer' })
  tmdbId: number | null;

  @Column({ nullable: true, name: 'cover_image_url', type: 'text' })
  coverImageUrl: string | null;

  /**
   * Comma-separated genre names stored via TypeORM simple-array.
   * Mirrors TMDB genres so the feed can match hubs to a user's genre preferences.
   * e.g. ["Action", "Science Fiction", "Adventure"]
   */
  @Column({ type: 'simple-array', default: '' })
  genres: string[];

  /** Denormalized — incremented/decremented by HubMembers triggers */
  @Column({ default: 0, name: 'member_count' })
  memberCount: number;

  /** Denormalized — incremented when a Post is created in this hub */
  @Column({ default: 0, name: 'post_count' })
  postCount: number;

  @OneToMany(() => Post, (post) => post.hub)
  posts: Post[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('title_hubs')
export class Hub {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true, type: 'integer' })
  year: number | null;

  @Column({ type: 'varchar', length: 10 })
  type: 'movie' | 'series';

  @Column({ nullable: true, type: 'text' })
  genres: string | null;

  @Column({ nullable: true, type: 'text' })
  director: string | null;

  @Column({ nullable: true, name: 'icon_url', type: 'text' })
  iconUrl: string | null;

  @Column({ nullable: true, name: 'backdrop_url', type: 'text' })
  backdropUrl: string | null;

  @Column({ nullable: true, type: 'text' })
  description: string | null;

  @Column({ name: 'followers_count', default: 0 })
  followersCount: number;

  @Column({ name: 'posts_count', default: 0 })
  postsCount: number;

  @Column({ name: 'trending_score', default: 0 })
  trendingScore: number;

  @Column({ nullable: true, name: 'tmdb_id', type: 'integer' })
  tmdbId: number | null;

  @Column({ nullable: true, name: 'trailer_key', type: 'text' })
  trailerKey: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

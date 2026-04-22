import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Hub } from '../../hubs/entities/hub.entity';

@Entity('posts')
export class Post {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'user_id' })
  author: User;

  @Column({ name: 'hub_id' })
  hubId: string;

  @ManyToOne(() => Hub, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'hub_id' })
  hub: Hub;

  @Column({ nullable: true, type: 'text' })
  title: string | null;

  @Column({ type: 'text' })
  body: string;

  @Column({ name: 'media_type', default: 'none', type: 'varchar', length: 10 })
  mediaType: 'none' | 'image' | 'video';

  @Column({ nullable: true, name: 'image_url', type: 'text' })
  imageUrl: string | null;

  @Column({ nullable: true, name: 'video_url', type: 'text' })
  videoUrl: string | null;

  @Column({ nullable: true, name: 'video_thumbnail_url', type: 'text' })
  videoThumbnailUrl: string | null;

  @Column({ nullable: true, name: 'video_duration_secs', type: 'integer' })
  videoDurationSecs: number | null;

  @Column({ name: 'has_spoiler', default: false })
  hasSpoiler: boolean;

  @Column({ name: 'likes_count', default: 0 })
  likesCount: number;

  @Column({ name: 'reposts_count', default: 0 })
  repostsCount: number;

  @Column({ name: 'comments_count', default: 0 })
  commentsCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'updated_at', nullable: true, type: 'text' })
  updatedAt: string | null;
}

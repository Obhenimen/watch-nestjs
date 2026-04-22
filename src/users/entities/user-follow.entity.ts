import { Entity, PrimaryColumn, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { User } from './user.entity';

@Entity('user_follows')
export class UserFollow {
  @PrimaryColumn({ name: 'follower_id' })
  followerId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'follower_id' })
  follower: User;

  @PrimaryColumn({ name: 'following_id' })
  followingId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'following_id' })
  following: User;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

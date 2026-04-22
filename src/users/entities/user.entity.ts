import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ name: 'password_hash', select: false })
  passwordHash: string;

  @Column({ unique: true })
  username: string;

  @Column({ name: 'display_name' })
  displayName: string;

  @Column({ nullable: true, type: 'text' })
  bio: string | null;

  @Column({ nullable: true, name: 'avatar_url', type: 'text' })
  avatarUrl: string | null;

  @Column({ name: 'followers_count', default: 0 })
  followersCount: number;

  @Column({ name: 'following_count', default: 0 })
  followingCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

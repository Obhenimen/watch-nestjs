import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  /** Stored as bcrypt hash — never expose in responses */
  @Column({ select: false })
  password: string;

  @Column({ unique: true })
  username: string;

  @Column({ nullable: true, type: 'text' })
  bio: string | null;

  @Column({ nullable: true, name: 'profile_picture_url', type: 'text' })
  profilePictureUrl: string | null;

  /**
   * Favourite genres chosen during onboarding (min 3).
   * Stored as a comma-separated string by TypeORM simple-array.
   */
  @Column({ type: 'simple-array' })
  genres: string[];

  /**
   * IDs of movies the user has watched (from the onboarding catalogue).
   * Stored as a comma-separated list of numbers.
   */
  @Column({ type: 'simple-array' })
  watchedMovieIds: number[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

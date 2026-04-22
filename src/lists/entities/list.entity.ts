import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('lists')
export class List {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'list_type', type: 'varchar', length: 20 })
  listType: 'watchlist' | 'watched' | 'favorites' | 'custom';

  @Column()
  name: string;

  @Column({ nullable: true, type: 'text' })
  emoji: string | null;

  @Column({ nullable: true, type: 'text' })
  description: string | null;

  @Column({ name: 'is_default', default: false })
  isDefault: boolean;

  @Column({ name: 'is_public', default: false })
  isPublic: boolean;

  @Column({ name: 'items_count', default: 0 })
  itemsCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

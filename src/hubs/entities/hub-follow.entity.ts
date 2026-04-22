import { Entity, PrimaryColumn, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Hub } from './hub.entity';

@Entity('hub_follows')
export class HubFollow {
  @PrimaryColumn({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @PrimaryColumn({ name: 'hub_id' })
  hubId: string;

  @ManyToOne(() => Hub, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'hub_id' })
  hub: Hub;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

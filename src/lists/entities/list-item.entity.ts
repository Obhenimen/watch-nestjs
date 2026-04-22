import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { List } from './list.entity';
import { Hub } from '../../hubs/entities/hub.entity';

@Entity('list_items')
export class ListItem {
  @PrimaryColumn({ name: 'list_id' })
  listId: string;

  @ManyToOne(() => List, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'list_id' })
  list: List;

  @PrimaryColumn({ name: 'hub_id' })
  hubId: string;

  @ManyToOne(() => Hub, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'hub_id' })
  hub: Hub;

  @Column({ nullable: true, type: 'varchar', length: 20 })
  status: 'watching' | 'watch_next' | null;

  @CreateDateColumn({ name: 'added_at' })
  addedAt: Date;
}

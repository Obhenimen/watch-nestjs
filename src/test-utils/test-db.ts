import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { UserFollow } from '../users/entities/user-follow.entity';
import { Post } from '../posts/entities/post.entity';
import { Like } from '../posts/entities/post-like.entity';
import { Repost } from '../posts/entities/repost.entity';
import { Hub } from '../hubs/entities/hub.entity';
import { HubFollow } from '../hubs/entities/hub-follow.entity';
import { Comment } from '../comments/entities/comment.entity';
import { CommentLike } from '../comments/entities/comment-like.entity';
import { List } from '../lists/entities/list.entity';
import { ListItem } from '../lists/entities/list-item.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { PasswordResetToken } from '../auth/entities/password-reset-token.entity';

// Every entity in the app — listed once here so each integration test can spin
// up a fresh in-memory schema without copy-pasting this list.
export const ALL_ENTITIES = [
  User,
  UserFollow,
  Post,
  Like,
  Repost,
  Hub,
  HubFollow,
  Comment,
  CommentLike,
  List,
  ListItem,
  Notification,
  PasswordResetToken,
];

// Each `:memory:` connection is its own database, so individual specs are
// fully isolated even though they share this config.
export function inMemoryDbConfig(): TypeOrmModuleOptions {
  return {
    type: 'better-sqlite3',
    database: ':memory:',
    dropSchema: true,
    entities: ALL_ENTITIES,
    synchronize: true,
    logging: false,
  };
}

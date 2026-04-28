import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationsService } from './notifications.service';
import { Notification } from './entities/notification.entity';
import { User } from '../users/entities/user.entity';
import { Post } from '../posts/entities/post.entity';
import { Comment } from '../comments/entities/comment.entity';
import { Hub } from '../hubs/entities/hub.entity';
import { inMemoryDbConfig } from '../test-utils/test-db';
import { makeUser } from '../test-utils/fixtures';

describe('NotificationsService', () => {
  let module: TestingModule;
  let service: NotificationsService;
  let notifRepo: Repository<Notification>;
  let userRepo: Repository<User>;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(inMemoryDbConfig()),
        TypeOrmModule.forFeature([Notification, User, Post, Comment, Hub]),
      ],
      providers: [NotificationsService],
    }).compile();

    service = module.get(NotificationsService);
    notifRepo = module.get(getRepositoryToken(Notification));
    userRepo = module.get(getRepositoryToken(User));
  });

  afterEach(async () => {
    await module.close();
  });

  it('drops self-actions silently (recipient === actor → no row)', async () => {
    const u = await makeUser(userRepo);
    await service.create({ recipientId: u.id, actorId: u.id, type: 'post_like' });
    expect(await notifRepo.count()).toBe(0);
  });

  it('persists a notification when recipient !== actor', async () => {
    const a = await makeUser(userRepo);
    const b = await makeUser(userRepo);
    await service.create({ recipientId: a.id, actorId: b.id, type: 'user_follow' });
    expect(await notifRepo.count()).toBe(1);
  });

  it('getUnreadCount returns only unread items for the recipient', async () => {
    const a = await makeUser(userRepo);
    const b = await makeUser(userRepo);
    await service.create({ recipientId: a.id, actorId: b.id, type: 'user_follow' });
    await service.create({ recipientId: a.id, actorId: b.id, type: 'post_like' });
    expect(await service.getUnreadCount(a.id)).toBe(2);

    await service.markAllRead(a.id);
    expect(await service.getUnreadCount(a.id)).toBe(0);
  });

  it('getForUser only returns notifications for the requested user', async () => {
    const a = await makeUser(userRepo);
    const b = await makeUser(userRepo);
    const actor = await makeUser(userRepo);
    await service.create({ recipientId: a.id, actorId: actor.id, type: 'user_follow' });
    await service.create({ recipientId: b.id, actorId: actor.id, type: 'user_follow' });

    const aFeed = await service.getForUser(a.id);
    expect(aFeed.notifications).toHaveLength(1);
    expect(aFeed.notifications[0].actor?.id).toBe(actor.id);
  });
});

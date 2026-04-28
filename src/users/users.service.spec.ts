import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { UsersService } from './users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { User } from './entities/user.entity';
import { UserFollow } from './entities/user-follow.entity';
import { List } from '../lists/entities/list.entity';
import { Post } from '../posts/entities/post.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { inMemoryDbConfig } from '../test-utils/test-db';
import { makeUser } from '../test-utils/fixtures';

describe('UsersService', () => {
  let module: TestingModule;
  let users: UsersService;
  let userRepo: Repository<User>;
  let followRepo: Repository<UserFollow>;
  let listRepo: Repository<List>;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(inMemoryDbConfig()),
        TypeOrmModule.forFeature([User, UserFollow, List, Post, Notification]),
      ],
      providers: [UsersService, NotificationsService],
    }).compile();

    users = module.get(UsersService);
    userRepo = module.get(getRepositoryToken(User));
    followRepo = module.get(getRepositoryToken(UserFollow));
    listRepo = module.get(getRepositoryToken(List));
  });

  afterEach(async () => {
    await module.close();
  });

  describe('create', () => {
    it('provisions the three default lists for every new user', async () => {
      const u = await users.create({
        email: 'a@x.test',
        passwordHash: 'h',
        username: 'aaa',
        displayName: 'Aaa',
      });
      const lists = await listRepo.find({ where: { userId: u.id } });
      expect(lists).toHaveLength(3);
      const types = lists.map((l) => l.listType).sort();
      expect(types).toEqual(['favorites', 'watched', 'watchlist']);
      expect(lists.every((l) => l.isDefault)).toBe(true);
    });
  });

  describe('toggleFollow', () => {
    it('rejects self-follow', async () => {
      const u = await makeUser(userRepo);
      await expect(users.toggleFollow(u.id, u.id)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException if target user does not exist', async () => {
      const u = await makeUser(userRepo);
      await expect(
        users.toggleFollow('00000000-0000-0000-0000-000000000000', u.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('increments followersCount on target and followingCount on follower', async () => {
      const target = await makeUser(userRepo);
      const follower = await makeUser(userRepo);

      await users.toggleFollow(target.id, follower.id);

      const t = await userRepo.findOneByOrFail({ id: target.id });
      const f = await userRepo.findOneByOrFail({ id: follower.id });
      expect(t.followersCount).toBe(1);
      expect(f.followingCount).toBe(1);
    });

    it('follow → unfollow returns counters to zero and deletes the row', async () => {
      const target = await makeUser(userRepo);
      const follower = await makeUser(userRepo);

      await users.toggleFollow(target.id, follower.id);
      await users.toggleFollow(target.id, follower.id);

      const t = await userRepo.findOneByOrFail({ id: target.id });
      const f = await userRepo.findOneByOrFail({ id: follower.id });
      expect(t.followersCount).toBe(0);
      expect(f.followingCount).toBe(0);
      const rows = await followRepo.find({ where: { followerId: follower.id } });
      expect(rows).toHaveLength(0);
    });

    it('counter equals the number of follow rows after a random sequence', async () => {
      const target = await makeUser(userRepo);
      const f1 = await makeUser(userRepo);
      const f2 = await makeUser(userRepo);
      const f3 = await makeUser(userRepo);

      await users.toggleFollow(target.id, f1.id);
      await users.toggleFollow(target.id, f2.id);
      await users.toggleFollow(target.id, f3.id);
      await users.toggleFollow(target.id, f2.id); // f2 unfollows

      const refreshed = await userRepo.findOneByOrFail({ id: target.id });
      const rowCount = await followRepo.count({ where: { followingId: target.id } });
      expect(refreshed.followersCount).toBe(rowCount);
      expect(refreshed.followersCount).toBe(2);
    });
  });

  describe('updateProfile', () => {
    it('rejects a username already taken by another user', async () => {
      const a = await makeUser(userRepo, { username: 'alpha' });
      const b = await makeUser(userRepo, { username: 'beta' });
      await expect(
        users.updateProfile(b.id, { username: 'alpha' }),
      ).rejects.toBeInstanceOf(ConflictException);
      // No-op for sanity:
      expect(a.username).toBe('alpha');
    });

    it('lets a user keep their existing username (no false collision)', async () => {
      const u = await makeUser(userRepo, { username: 'mine' });
      await expect(
        users.updateProfile(u.id, { username: 'mine', displayName: 'Renamed' }),
      ).resolves.toBeDefined();
    });

    it('treats empty bio as a clear (sets to null)', async () => {
      const u = await makeUser(userRepo, { bio: 'old bio' });
      await users.updateProfile(u.id, { bio: '' });
      const refreshed = await userRepo.findOneByOrFail({ id: u.id });
      expect(refreshed.bio).toBeNull();
    });
  });

  describe('getProfile', () => {
    it('hides email when viewer is not the user themself', async () => {
      const a = await makeUser(userRepo);
      const b = await makeUser(userRepo);
      const profile = await users.getProfile(a.id, b.id);
      expect(profile.email).toBeUndefined();
    });

    it('reveals email when viewer is the user themself', async () => {
      const a = await makeUser(userRepo);
      const profile = await users.getProfile(a.id, a.id);
      expect(profile.email).toBe(a.email);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { PostsService } from './posts.service';
import { FeedRankingService } from './feed-ranking.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Post } from './entities/post.entity';
import { Like } from './entities/post-like.entity';
import { Repost } from './entities/repost.entity';
import { Hub } from '../hubs/entities/hub.entity';
import { HubFollow } from '../hubs/entities/hub-follow.entity';
import { UserFollow } from '../users/entities/user-follow.entity';
import { User } from '../users/entities/user.entity';
import { Comment } from '../comments/entities/comment.entity';
import { List } from '../lists/entities/list.entity';
import { ListItem } from '../lists/entities/list-item.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { inMemoryDbConfig } from '../test-utils/test-db';
import { makeUser, makeHub, makePost } from '../test-utils/fixtures';

describe('PostsService', () => {
  let module: TestingModule;
  let posts: PostsService;
  let userRepo: Repository<User>;
  let hubRepo: Repository<Hub>;
  let postRepo: Repository<Post>;
  let likeRepo: Repository<Like>;
  let repostRepo: Repository<Repost>;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(inMemoryDbConfig()),
        TypeOrmModule.forFeature([
          Post,
          Like,
          Repost,
          Hub,
          HubFollow,
          UserFollow,
          User,
          Comment,
          List,
          ListItem,
          Notification,
        ]),
      ],
      providers: [PostsService, FeedRankingService, NotificationsService],
    }).compile();

    posts = module.get(PostsService);
    userRepo = module.get(getRepositoryToken(User));
    hubRepo = module.get(getRepositoryToken(Hub));
    postRepo = module.get(getRepositoryToken(Post));
    likeRepo = module.get(getRepositoryToken(Like));
    repostRepo = module.get(getRepositoryToken(Repost));
  });

  afterEach(async () => {
    await module.close();
  });

  describe('create', () => {
    it('saves a post and increments hub.postsCount', async () => {
      const user = await makeUser(userRepo);
      const hub = await makeHub(hubRepo);
      const initialCount = hub.postsCount;

      await posts.create(user, { hubId: hub.id, body: 'first post' });

      const refreshed = await hubRepo.findOneByOrFail({ id: hub.id });
      expect(refreshed.postsCount).toBe(initialCount + 1);
    });

    it('throws NotFoundException when the hub does not exist', async () => {
      const user = await makeUser(userRepo);
      await expect(
        posts.create(user, { hubId: '00000000-0000-0000-0000-000000000000', body: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('toggleLike', () => {
    it('like → unlike returns the counter exactly to zero', async () => {
      const author = await makeUser(userRepo);
      const viewer = await makeUser(userRepo);
      const hub = await makeHub(hubRepo);
      const post = await makePost(postRepo, author, hub);

      const after1 = await posts.toggleLike(post.id, viewer.id);
      expect(after1.liked).toBe(true);
      expect(after1.likesCount).toBe(1);

      const after2 = await posts.toggleLike(post.id, viewer.id);
      expect(after2.liked).toBe(false);
      expect(after2.likesCount).toBe(0);

      const likes = await likeRepo.find({ where: { postId: post.id } });
      expect(likes).toHaveLength(0);
    });

    it('counter equals the number of like rows after random toggle sequences', async () => {
      const author = await makeUser(userRepo);
      const hub = await makeHub(hubRepo);
      const post = await makePost(postRepo, author, hub);

      const viewers = await Promise.all([1, 2, 3, 4, 5].map(() => makeUser(userRepo)));
      // Each viewer toggles a random number of times (1 or 2 times).
      for (const v of viewers) {
        await posts.toggleLike(post.id, v.id);
      }
      // Two of them unlike.
      await posts.toggleLike(post.id, viewers[0].id);
      await posts.toggleLike(post.id, viewers[2].id);

      const refreshed = await postRepo.findOneByOrFail({ id: post.id });
      const rowCount = await likeRepo.count({ where: { postId: post.id } });
      expect(refreshed.likesCount).toBe(rowCount);
      expect(refreshed.likesCount).toBe(3);
    });

    it('does not create a notification when a user likes their own post', async () => {
      const author = await makeUser(userRepo);
      const hub = await makeHub(hubRepo);
      const post = await makePost(postRepo, author, hub);

      await posts.toggleLike(post.id, author.id);
      const notifRepo = module.get<Repository<Notification>>(getRepositoryToken(Notification));
      const notifs = await notifRepo.find({ where: { recipientId: author.id } });
      expect(notifs).toHaveLength(0);
    });
  });

  describe('toggleRepost', () => {
    it('toggles symmetrically and keeps repostsCount in sync with rows', async () => {
      const author = await makeUser(userRepo);
      const viewer = await makeUser(userRepo);
      const hub = await makeHub(hubRepo);
      const post = await makePost(postRepo, author, hub);

      await posts.toggleRepost(post.id, viewer.id);
      let refreshed = await postRepo.findOneByOrFail({ id: post.id });
      expect(refreshed.repostsCount).toBe(1);
      expect(await repostRepo.count({ where: { postId: post.id } })).toBe(1);

      await posts.toggleRepost(post.id, viewer.id);
      refreshed = await postRepo.findOneByOrFail({ id: post.id });
      expect(refreshed.repostsCount).toBe(0);
      expect(await repostRepo.count({ where: { postId: post.id } })).toBe(0);
    });
  });

  describe('remove (authorization)', () => {
    it('lets the author delete their own post', async () => {
      const author = await makeUser(userRepo);
      const hub = await makeHub(hubRepo);
      const post = await makePost(postRepo, author, hub);

      await posts.remove(post.id, author.id);
      const found = await postRepo.findOne({ where: { id: post.id } });
      expect(found).toBeNull();
    });

    it('rejects another user trying to delete the post', async () => {
      const author = await makeUser(userRepo);
      const stranger = await makeUser(userRepo);
      const hub = await makeHub(hubRepo);
      const post = await makePost(postRepo, author, hub);

      await expect(posts.remove(post.id, stranger.id)).rejects.toBeInstanceOf(ForbiddenException);
      const stillThere = await postRepo.findOne({ where: { id: post.id } });
      expect(stillThere).not.toBeNull();
    });

    it('decrements hub.postsCount when a post is removed', async () => {
      const author = await makeUser(userRepo);
      const hub = await makeHub(hubRepo, { postsCount: 1 });
      const post = await makePost(postRepo, author, hub);

      await posts.remove(post.id, author.id);
      const refreshed = await hubRepo.findOneByOrFail({ id: hub.id });
      expect(refreshed.postsCount).toBe(0);
    });
  });

  describe('findById', () => {
    it('throws NotFoundException for an unknown post id', async () => {
      await expect(
        posts.findById('00000000-0000-0000-0000-000000000000'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns likedByMe / repostedByMe based on viewer state', async () => {
      const author = await makeUser(userRepo);
      const viewer = await makeUser(userRepo);
      const hub = await makeHub(hubRepo);
      const post = await makePost(postRepo, author, hub);

      await posts.toggleLike(post.id, viewer.id);
      const seen = await posts.findById(post.id, viewer.id);
      expect(seen.likedByMe).toBe(true);
      expect(seen.repostedByMe).toBe(false);
    });
  });
});

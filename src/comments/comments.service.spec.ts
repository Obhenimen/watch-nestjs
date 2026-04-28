import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { CommentsService } from './comments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Comment } from './entities/comment.entity';
import { CommentLike } from './entities/comment-like.entity';
import { Post } from '../posts/entities/post.entity';
import { Hub } from '../hubs/entities/hub.entity';
import { User } from '../users/entities/user.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { inMemoryDbConfig } from '../test-utils/test-db';
import { makeUser, makeHub, makePost } from '../test-utils/fixtures';

describe('CommentsService', () => {
  let module: TestingModule;
  let comments: CommentsService;
  let userRepo: Repository<User>;
  let hubRepo: Repository<Hub>;
  let postRepo: Repository<Post>;
  let commentRepo: Repository<Comment>;
  let likeRepo: Repository<CommentLike>;
  let notifRepo: Repository<Notification>;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(inMemoryDbConfig()),
        TypeOrmModule.forFeature([Comment, CommentLike, Post, Hub, User, Notification]),
      ],
      providers: [CommentsService, NotificationsService],
    }).compile();

    comments = module.get(CommentsService);
    userRepo = module.get(getRepositoryToken(User));
    hubRepo = module.get(getRepositoryToken(Hub));
    postRepo = module.get(getRepositoryToken(Post));
    commentRepo = module.get(getRepositoryToken(Comment));
    likeRepo = module.get(getRepositoryToken(CommentLike));
    notifRepo = module.get(getRepositoryToken(Notification));
  });

  afterEach(async () => {
    await module.close();
  });

  describe('create', () => {
    it('saves a top-level comment and increments post.commentsCount', async () => {
      const author = await makeUser(userRepo);
      const commenter = await makeUser(userRepo);
      const hub = await makeHub(hubRepo);
      const post = await makePost(postRepo, author, hub);

      await comments.create(post.id, commenter, { body: 'first comment' });

      const refreshed = await postRepo.findOneByOrFail({ id: post.id });
      expect(refreshed.commentsCount).toBe(1);
    });

    it('notifies the post author when someone else comments', async () => {
      const author = await makeUser(userRepo);
      const commenter = await makeUser(userRepo);
      const hub = await makeHub(hubRepo);
      const post = await makePost(postRepo, author, hub);

      await comments.create(post.id, commenter, { body: 'hi' });

      const notifs = await notifRepo.find({ where: { recipientId: author.id } });
      expect(notifs).toHaveLength(1);
      expect(notifs[0].type).toBe('post_comment');
    });

    it('does NOT notify the post author when they comment on their own post', async () => {
      const author = await makeUser(userRepo);
      const hub = await makeHub(hubRepo);
      const post = await makePost(postRepo, author, hub);

      await comments.create(post.id, author, { body: 'self comment' });
      const notifs = await notifRepo.find({ where: { recipientId: author.id } });
      expect(notifs).toHaveLength(0);
    });

    it('throws NotFoundException for an unknown post', async () => {
      const u = await makeUser(userRepo);
      await expect(
        comments.create('00000000-0000-0000-0000-000000000000', u, { body: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a parent that belongs to a different post', async () => {
      const author = await makeUser(userRepo);
      const hub = await makeHub(hubRepo);
      const postA = await makePost(postRepo, author, hub);
      const postB = await makePost(postRepo, author, hub);
      const parentOnA = await comments.create(postA.id, author, { body: 'parent on A' });

      await expect(
        comments.create(postB.id, author, { body: 'reply', parentId: parentOnA.id }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('replies notify the parent comment author, not the post author', async () => {
      const postAuthor = await makeUser(userRepo);
      const commenter = await makeUser(userRepo);
      const replier = await makeUser(userRepo);
      const hub = await makeHub(hubRepo);
      const post = await makePost(postRepo, postAuthor, hub);
      const parent = await comments.create(post.id, commenter, { body: 'top-level' });

      // Clear notifications from the create above so we can isolate the reply notification.
      await notifRepo.clear();
      await comments.create(post.id, replier, { body: 'reply', parentId: parent.id });

      const notifs = await notifRepo.find();
      expect(notifs).toHaveLength(1);
      expect(notifs[0].recipientId).toBe(commenter.id);
      expect(notifs[0].type).toBe('comment_reply');
    });
  });

  describe('toggleLike', () => {
    it('like → unlike keeps likesCount in sync with rows', async () => {
      const author = await makeUser(userRepo);
      const liker = await makeUser(userRepo);
      const hub = await makeHub(hubRepo);
      const post = await makePost(postRepo, author, hub);
      const c = await comments.create(post.id, author, { body: 'x' });

      await comments.toggleLike(c.id, liker.id);
      let refreshed = await commentRepo.findOneByOrFail({ id: c.id });
      expect(refreshed.likesCount).toBe(1);
      expect(await likeRepo.count({ where: { commentId: c.id } })).toBe(1);

      await comments.toggleLike(c.id, liker.id);
      refreshed = await commentRepo.findOneByOrFail({ id: c.id });
      expect(refreshed.likesCount).toBe(0);
      expect(await likeRepo.count({ where: { commentId: c.id } })).toBe(0);
    });
  });

  describe('remove (authorization)', () => {
    it('lets the author delete their own comment and decrements commentsCount', async () => {
      const author = await makeUser(userRepo);
      const hub = await makeHub(hubRepo);
      const post = await makePost(postRepo, author, hub);
      const c = await comments.create(post.id, author, { body: 'mine' });

      await comments.remove(c.id, author.id);

      const found = await commentRepo.findOne({ where: { id: c.id } });
      expect(found).toBeNull();
      const refreshed = await postRepo.findOneByOrFail({ id: post.id });
      expect(refreshed.commentsCount).toBe(0);
    });

    it('rejects another user trying to delete', async () => {
      const author = await makeUser(userRepo);
      const stranger = await makeUser(userRepo);
      const hub = await makeHub(hubRepo);
      const post = await makePost(postRepo, author, hub);
      const c = await comments.create(post.id, author, { body: 'mine' });

      await expect(comments.remove(c.id, stranger.id)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});

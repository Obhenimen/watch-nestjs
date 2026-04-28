import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FeedRankingService } from './feed-ranking.service';
import { Post } from './entities/post.entity';
import { Hub } from '../hubs/entities/hub.entity';
import { HubFollow } from '../hubs/entities/hub-follow.entity';
import { UserFollow } from '../users/entities/user-follow.entity';
import { User } from '../users/entities/user.entity';
import { List } from '../lists/entities/list.entity';
import { ListItem } from '../lists/entities/list-item.entity';
import { inMemoryDbConfig } from '../test-utils/test-db';
import { makeUser, makeHub, makePost } from '../test-utils/fixtures';

describe('FeedRankingService', () => {
  let module: TestingModule;
  let service: FeedRankingService;
  let userRepo: Repository<User>;
  let hubRepo: Repository<Hub>;
  let postRepo: Repository<Post>;
  let hubFollowRepo: Repository<HubFollow>;
  let userFollowRepo: Repository<UserFollow>;
  let listRepo: Repository<List>;
  let listItemRepo: Repository<ListItem>;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(inMemoryDbConfig()),
        TypeOrmModule.forFeature([Post, Hub, HubFollow, UserFollow, User, List, ListItem]),
      ],
      providers: [FeedRankingService],
    }).compile();

    service = module.get(FeedRankingService);
    userRepo = module.get(getRepositoryToken(User));
    hubRepo = module.get(getRepositoryToken(Hub));
    postRepo = module.get(getRepositoryToken(Post));
    hubFollowRepo = module.get(getRepositoryToken(HubFollow));
    userFollowRepo = module.get(getRepositoryToken(UserFollow));
    listRepo = module.get(getRepositoryToken(List));
    listItemRepo = module.get(getRepositoryToken(ListItem));
  });

  afterEach(async () => {
    await module.close();
  });

  describe('self-authored posts', () => {
    it('does not show the viewer their own posts', async () => {
      const viewer = await makeUser(userRepo);
      const other = await makeUser(userRepo);
      const hub = await makeHub(hubRepo);
      // Highest-engagement post is the viewer's own — under the old code it
      // would have ranked first; now it should be filtered out entirely.
      const ownPost = await makePost(postRepo, viewer, hub, { likesCount: 100, body: 'mine' });
      await makePost(postRepo, other, hub, { likesCount: 1, body: 'theirs' });

      const { posts } = await service.rank(viewer.id, 10, 0);
      expect(posts.find((p) => p.id === ownPost.id)).toBeUndefined();
      expect(posts.every((p) => p.userId !== viewer.id)).toBe(true);
    });

    it('falls back to other recent posts in cold start (still excluding self)', async () => {
      const viewer = await makeUser(userRepo);
      const other = await makeUser(userRepo);
      const hub = await makeHub(hubRepo);
      // Only one post and it belongs to the viewer.
      await makePost(postRepo, viewer, hub, { body: 'mine, alone' });
      // A different author's post that should still surface via cold start.
      const othersPost = await makePost(postRepo, other, hub, { body: 'theirs' });

      const { posts } = await service.rank(viewer.id, 10, 0);
      expect(posts.every((p) => p.userId !== viewer.id)).toBe(true);
      expect(posts.find((p) => p.id === othersPost.id)).toBeDefined();
    });
  });

  describe('cold start', () => {
    it('returns recent posts when viewer has no follows / lists / favorites', async () => {
      const author = await makeUser(userRepo);
      const hub = await makeHub(hubRepo);
      await makePost(postRepo, author, hub, { body: 'Recent post' });

      const viewer = await makeUser(userRepo);
      const { posts, totalCandidates } = await service.rank(viewer.id, 10, 0);

      expect(posts.length).toBeGreaterThan(0);
      expect(totalCandidates).toBeGreaterThan(0);
    });

    it('returns empty when there are no posts in the database at all', async () => {
      const viewer = await makeUser(userRepo);
      const { posts, totalCandidates } = await service.rank(viewer.id, 10, 0);
      expect(posts).toEqual([]);
      expect(totalCandidates).toBe(0);
    });
  });

  describe('personalisation', () => {
    it('surfaces a post from the favourite hub even when it has zero engagement', async () => {
      // This guards the `1 + log(1+x)` baseline — with the bare `log(1+x)` form,
      // engagement would be 0 and the whole product would collapse, so affinity
      // wouldn't matter and the post wouldn't rank.
      const author = await makeUser(userRepo);
      const lovedHub = await makeHub(hubRepo, { name: 'Loved' });
      const unrelatedHub = await makeHub(hubRepo, { name: 'Unrelated' });

      const lovedPost = await makePost(postRepo, author, lovedHub, { body: 'about loved' });
      // Off-hub post with no engagement — under the new pool restriction it's
      // simply not a candidate, which is the right behaviour.
      const unrelatedPost = await makePost(postRepo, author, unrelatedHub, { body: 'about other' });

      const viewer = await makeUser(userRepo);
      const favoritesList = await listRepo.save(
        listRepo.create({ userId: viewer.id, listType: 'favorites', name: 'Favorites', isDefault: true }),
      );
      await listItemRepo.save(listItemRepo.create({ listId: favoritesList.id, hubId: lovedHub.id }));

      const { posts } = await service.rank(viewer.id, 10, 0);
      expect(posts.find((p) => p.id === lovedPost.id)).toBeDefined();
      expect(posts.find((p) => p.id === unrelatedPost.id)).toBeUndefined();
    });

    it('two viewers with different profiles see different feeds', async () => {
      const author = await makeUser(userRepo);
      const hubA = await makeHub(hubRepo, { name: 'A' });
      const hubB = await makeHub(hubRepo, { name: 'B' });

      // Two posts per hub so each viewer's affinity has a chance to dominate.
      await makePost(postRepo, author, hubA);
      await makePost(postRepo, author, hubA);
      await makePost(postRepo, author, hubB);
      await makePost(postRepo, author, hubB);

      const viewerA = await makeUser(userRepo);
      const viewerB = await makeUser(userRepo);
      await hubFollowRepo.save(hubFollowRepo.create({ userId: viewerA.id, hubId: hubA.id }));
      await hubFollowRepo.save(hubFollowRepo.create({ userId: viewerB.id, hubId: hubB.id }));

      const { posts: feedA } = await service.rank(viewerA.id, 10, 0);
      const { posts: feedB } = await service.rank(viewerB.id, 10, 0);

      // Top of each feed should match that viewer's followed hub.
      expect(feedA[0].hubId).toBe(hubA.id);
      expect(feedB[0].hubId).toBe(hubB.id);
    });

    it('boosts posts from authors the viewer follows', async () => {
      const followedAuthor = await makeUser(userRepo);
      const otherAuthor = await makeUser(userRepo);
      const hub = await makeHub(hubRepo);

      await makePost(postRepo, otherAuthor, hub, { body: 'from stranger' });
      const followedPost = await makePost(postRepo, followedAuthor, hub, { body: 'from friend' });

      const viewer = await makeUser(userRepo);
      await userFollowRepo.save(
        userFollowRepo.create({ followerId: viewer.id, followingId: followedAuthor.id }),
      );

      const { posts } = await service.rank(viewer.id, 10, 0);
      expect(posts[0].id).toBe(followedPost.id);
    });
  });

  describe('off-genre virality does not outrank personalised content', () => {
    it('an off-hub viral post is not a candidate when the viewer has a profile', async () => {
      const author = await makeUser(userRepo);
      const actionHub = await makeHub(hubRepo, { name: 'Action Hub', genres: 'Action, Adventure' });
      const offGenreHub = await makeHub(hubRepo, { name: 'Comedy Hub', genres: 'Comedy, Talk' });

      const onGenrePost = await makePost(postRepo, author, actionHub, { likesCount: 3 });
      const offGenreViralPost = await makePost(postRepo, author, offGenreHub, { likesCount: 50 });

      const viewer = await makeUser(userRepo);
      const favorites = await listRepo.save(
        listRepo.create({ userId: viewer.id, listType: 'favorites', name: 'Favorites', isDefault: true }),
      );
      await listItemRepo.save(listItemRepo.create({ listId: favorites.id, hubId: actionHub.id }));

      const { posts } = await service.rank(viewer.id, 10, 0);
      expect(posts.find((p) => p.id === onGenrePost.id)).toBeDefined();
      expect(posts.find((p) => p.id === offGenreViralPost.id)).toBeUndefined();
    });

    it('a circumstantial genre overlap with a TV-format tag does not promote a viral off-hub post', async () => {
      // The bug we hit on real data: a TV show in the viewer's profile put
      // "sci-fi & fantasy" in their genre weights at ~0.4. A viral comedy
      // tagged "Sci-Fi & Fantasy" got affinity ~0.08 from that single overlap,
      // which under the affinity-only floor split lifted it into the same
      // generous floor as posts in hubs the viewer actually followed.
      // Belt-and-braces fix: explicit-only floor + trending-pool restriction.
      const author = await makeUser(userRepo);
      const followedHub = await makeHub(hubRepo, { name: 'Followed', genres: 'Action, Adventure' });
      const tvHub = await makeHub(hubRepo, { name: 'TV Show', genres: 'Sci-Fi & Fantasy, Action' });
      const offGenreHub = await makeHub(hubRepo, { name: 'Comedy', genres: 'Sci-Fi & Fantasy, Comedy' });

      const inHubLowEng = await makePost(postRepo, author, followedHub, { likesCount: 3 });
      const offViralPost = await makePost(postRepo, author, offGenreHub, { likesCount: 50 });

      const viewer = await makeUser(userRepo);
      await hubFollowRepo.save(hubFollowRepo.create({ userId: viewer.id, hubId: followedHub.id }));
      await hubFollowRepo.save(hubFollowRepo.create({ userId: viewer.id, hubId: tvHub.id }));

      const { posts } = await service.rank(viewer.id, 10, 0);
      expect(posts.find((p) => p.id === inHubLowEng.id)).toBeDefined();
      expect(posts.find((p) => p.id === offViralPost.id)).toBeUndefined();
    });

    it('an off-hub viral post does not appear via the trending pool when the viewer has a profile', async () => {
      // Even when a viewer's interested-hubs pool is small, a high-engagement
      // viral post in a hub the viewer has shown ZERO interest in should not
      // muscle in via global trending. (Cold-start users still get unfiltered
      // trending — covered by the cold-start tests above.)
      const author = await makeUser(userRepo);
      const followedHub = await makeHub(hubRepo);
      const offHub = await makeHub(hubRepo);

      // Just one in-hub post — interesting tail slots will need filling.
      const inHubPost = await makePost(postRepo, author, followedHub, { likesCount: 1 });
      // A globally viral off-hub post.
      const viralOffHubPost = await makePost(postRepo, author, offHub, { likesCount: 100 });

      const viewer = await makeUser(userRepo);
      await hubFollowRepo.save(hubFollowRepo.create({ userId: viewer.id, hubId: followedHub.id }));

      const { posts } = await service.rank(viewer.id, 10, 0);
      expect(posts.find((p) => p.id === inHubPost.id)).toBeDefined();
      expect(posts.find((p) => p.id === viralOffHubPost.id)).toBeUndefined();
    });

    it('still ranks off-genre posts among themselves by engagement (cold-start path)', async () => {
      // Viewer with no profile data: every post is "no match", but they should
      // still see the more-engaging post above the less-engaging one.
      const author = await makeUser(userRepo);
      const hubA = await makeHub(hubRepo);
      const hubB = await makeHub(hubRepo);
      const lowEng = await makePost(postRepo, author, hubA, { likesCount: 0 });
      const highEng = await makePost(postRepo, author, hubB, { likesCount: 50 });

      const viewer = await makeUser(userRepo);
      const { posts } = await service.rank(viewer.id, 10, 0);
      const lowIdx = posts.findIndex((p) => p.id === lowEng.id);
      const highIdx = posts.findIndex((p) => p.id === highEng.id);
      expect(highIdx).toBeLessThan(lowIdx);
    });
  });

  describe('engagement & freshness', () => {
    it('a high-engagement post beats a zero-engagement post in the same hub', async () => {
      const author = await makeUser(userRepo);
      const hub = await makeHub(hubRepo);
      const quietPost = await makePost(postRepo, author, hub, { likesCount: 0 });
      const popularPost = await makePost(postRepo, author, hub, {
        likesCount: 50,
        repostsCount: 10,
        commentsCount: 20,
      });

      const viewer = await makeUser(userRepo);
      const { posts } = await service.rank(viewer.id, 10, 0);

      const popularIdx = posts.findIndex((p) => p.id === popularPost.id);
      const quietIdx = posts.findIndex((p) => p.id === quietPost.id);
      expect(popularIdx).toBeLessThan(quietIdx);
    });

    it('demotes spoiler posts when the viewer has not watched the title', async () => {
      const author = await makeUser(userRepo);
      const hub = await makeHub(hubRepo);
      const spoilerPost = await makePost(postRepo, author, hub, { hasSpoiler: true, body: 'spoiler' });
      const cleanPost = await makePost(postRepo, author, hub, { hasSpoiler: false, body: 'clean' });

      const viewer = await makeUser(userRepo);
      const { posts } = await service.rank(viewer.id, 10, 0);

      const spoilerIdx = posts.findIndex((p) => p.id === spoilerPost.id);
      const cleanIdx = posts.findIndex((p) => p.id === cleanPost.id);
      expect(cleanIdx).toBeLessThan(spoilerIdx);
    });

    it('does NOT demote spoilers when the viewer has watched the title', async () => {
      const author = await makeUser(userRepo);
      const hub = await makeHub(hubRepo);
      const spoilerPost = await makePost(postRepo, author, hub, {
        hasSpoiler: true,
        likesCount: 10, // give the spoiler post real engagement so the comparison is meaningful
      });
      const cleanPost = await makePost(postRepo, author, hub, { hasSpoiler: false, likesCount: 0 });

      const viewer = await makeUser(userRepo);
      const watched = await listRepo.save(
        listRepo.create({ userId: viewer.id, listType: 'watched', name: 'Watched', isDefault: true }),
      );
      await listItemRepo.save(listItemRepo.create({ listId: watched.id, hubId: hub.id }));

      const { posts } = await service.rank(viewer.id, 10, 0);
      const spoilerIdx = posts.findIndex((p) => p.id === spoilerPost.id);
      const cleanIdx = posts.findIndex((p) => p.id === cleanPost.id);
      expect(spoilerIdx).toBeLessThan(cleanIdx);
    });
  });

  describe('diversity', () => {
    it('does not put 5 posts from the same hub at the very top', async () => {
      const author = await makeUser(userRepo);
      const dominantHub = await makeHub(hubRepo, { name: 'Dominant' });
      const otherHubs = await Promise.all([
        makeHub(hubRepo, { name: 'Other 1' }),
        makeHub(hubRepo, { name: 'Other 2' }),
        makeHub(hubRepo, { name: 'Other 3' }),
      ]);

      // Five posts in one hub, all with similar engagement.
      for (let i = 0; i < 5; i++) {
        await makePost(postRepo, author, dominantHub, { likesCount: 10 });
      }
      // One post in each of three other hubs with the same engagement.
      for (const h of otherHubs) {
        await makePost(postRepo, author, h, { likesCount: 10 });
      }

      const viewer = await makeUser(userRepo);
      const { posts } = await service.rank(viewer.id, 8, 0);
      const top4HubIds = new Set(posts.slice(0, 4).map((p) => p.hubId));
      expect(top4HubIds.size).toBeGreaterThanOrEqual(3);
    });
  });

  describe('pagination', () => {
    it('offset N skips the first N ranked posts', async () => {
      const author = await makeUser(userRepo);
      const hub = await makeHub(hubRepo);
      for (let i = 0; i < 12; i++) {
        await makePost(postRepo, author, hub, { likesCount: i });
      }

      const viewer = await makeUser(userRepo);
      const page0 = await service.rank(viewer.id, 5, 0);
      const page1 = await service.rank(viewer.id, 5, 5);

      const page0Ids = new Set(page0.posts.map((p) => p.id));
      const overlap = page1.posts.filter((p) => page0Ids.has(p.id));
      expect(overlap).toHaveLength(0);
    });
  });

  describe('first-page spoiler quota', () => {
    it('promotes up to 3 spoilers into the visible page when several exist in the pool', async () => {
      const author = await makeUser(userRepo);
      const hub = await makeHub(hubRepo);

      // 10 high-engagement non-spoiler posts that would otherwise fill the top.
      for (let i = 0; i < 10; i++) {
        await makePost(postRepo, author, hub, { likesCount: 50, hasSpoiler: false });
      }
      // 5 low-engagement spoilers that would be off the page without the quota.
      for (let i = 0; i < 5; i++) {
        await makePost(postRepo, author, hub, { likesCount: 0, hasSpoiler: true });
      }

      const viewer = await makeUser(userRepo);
      const { posts } = await service.rank(viewer.id, 10, 0);

      // Quota is 3 — expect at least 3 spoilers in the first 10 results.
      expect(posts.filter((p) => p.hasSpoiler).length).toBeGreaterThanOrEqual(3);
    });

    it('promotes whatever is available when the pool has fewer spoilers than the quota', async () => {
      const author = await makeUser(userRepo);
      const hub = await makeHub(hubRepo);
      for (let i = 0; i < 8; i++) {
        await makePost(postRepo, author, hub, { likesCount: 50, hasSpoiler: false });
      }
      // Only one spoiler post exists.
      const onlySpoiler = await makePost(postRepo, author, hub, { likesCount: 0, hasSpoiler: true });

      const viewer = await makeUser(userRepo);
      const { posts } = await service.rank(viewer.id, 5, 0);
      expect(posts.some((p) => p.id === onlySpoiler.id)).toBe(true);
    });

    it('does not place any spoiler at slot 0 (top result stays the most personalised pick)', async () => {
      const author = await makeUser(userRepo);
      const hub = await makeHub(hubRepo);
      for (let i = 0; i < 8; i++) {
        await makePost(postRepo, author, hub, { likesCount: 80, hasSpoiler: false });
      }
      for (let i = 0; i < 5; i++) {
        await makePost(postRepo, author, hub, { likesCount: 0, hasSpoiler: true });
      }

      const viewer = await makeUser(userRepo);
      const { posts } = await service.rank(viewer.id, 10, 0);
      expect(posts[0].hasSpoiler).toBe(false);
    });

    it('distributes spoilers through the page rather than clumping them at the bottom', async () => {
      const author = await makeUser(userRepo);
      const hub = await makeHub(hubRepo);
      for (let i = 0; i < 10; i++) {
        await makePost(postRepo, author, hub, { likesCount: 80, hasSpoiler: false });
      }
      for (let i = 0; i < 5; i++) {
        await makePost(postRepo, author, hub, { likesCount: 0, hasSpoiler: true });
      }

      const viewer = await makeUser(userRepo);
      const { posts } = await service.rank(viewer.id, 10, 0);
      const spoilerSlots = posts
        .map((p, idx) => (p.hasSpoiler ? idx : -1))
        .filter((idx) => idx >= 0);

      // At least one spoiler should appear in the upper half of the page —
      // not all crammed into positions 8/9.
      expect(spoilerSlots.some((idx) => idx <= 5)).toBe(true);
    });

    it('is a no-op when the candidate pool has no spoilers', async () => {
      const author = await makeUser(userRepo);
      const hub = await makeHub(hubRepo);
      for (let i = 0; i < 5; i++) {
        await makePost(postRepo, author, hub, { hasSpoiler: false });
      }

      const viewer = await makeUser(userRepo);
      const { posts } = await service.rank(viewer.id, 5, 0);
      expect(posts.every((p) => !p.hasSpoiler)).toBe(true);
    });
  });

  describe('candidate window (date format)', () => {
    it('includes posts created today (regression test for ISO vs SQLite-format mismatch)', async () => {
      // The bug we're guarding against: passing a `Date.toISOString()` string
      // (with `T` and `Z`) to a SQLite text comparison sorts lexicographically
      // wrong against the DB's stored "YYYY-MM-DD HH:MM:SS.sss" format.
      const author = await makeUser(userRepo);
      const hub = await makeHub(hubRepo);
      const todaysPost = await makePost(postRepo, author, hub, { body: 'today' });

      const viewer = await makeUser(userRepo);
      const { posts } = await service.rank(viewer.id, 10, 0);
      expect(posts.find((p) => p.id === todaysPost.id)).toBeDefined();
    });
  });
});

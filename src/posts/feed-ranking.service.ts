import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Post } from './entities/post.entity';
import { Hub } from '../hubs/entities/hub.entity';
import { HubFollow } from '../hubs/entities/hub-follow.entity';
import { UserFollow } from '../users/entities/user-follow.entity';
import { List } from '../lists/entities/list.entity';
import { ListItem } from '../lists/entities/list-item.entity';

type ListBucket = 'watchlist' | 'watched' | 'favorites';

interface ViewerProfile {
  viewerId: string;
  followedHubs: Set<string>;
  followedUsers: Set<string>;
  watchlistHubs: Set<string>;
  watchedHubs: Set<string>;
  favoriteHubs: Set<string>;
  // genre name (lowercased) -> affinity in [0, 1]
  genreWeights: Map<string, number>;
}

interface ScoredPost {
  post: Post;
  score: number;
}

// Score weights — collected here so they're easy to tune without hunting through
// the math. See FOR_YOU_FEED.md for the rationale behind each.
const W = {
  affinityFollowsHub: 0.5,
  affinityFavoriteHub: 0.4,
  affinityWatchlistHub: 0.3,
  affinityWatchedHub: 0.2,
  affinityFollowsAuthor: 0.4,
  affinityGenre: 0.2,
  affinityFloor: 0.5,
  affinityFloorNoMatch: 0.05,
  affinityMatchBonus: 5.0,
  engagementLike: 3,
  engagementRepost: 2,
  engagementComment: 1.5,
  freshnessHalfLifeHours: 72,
  authorBoost: 0.1,
  spoilerPenaltyUnwatched: 0.85,
  spoilerQuotaFirstPage: 3,
  diversityHubDecay: 0.6,
  diversityAuthorDecay: 0.7,
  candidateWindowDays: 30,
  trendingWindowDays: 14,
  poolInterestedHubs: 150,
  poolFollowedUsers: 80,
  poolGloballyTrending: 60,
  poolBroadRecent: 200,
  poolColdStart: 60,
};

@Injectable()
export class FeedRankingService {
  constructor(
    @InjectRepository(Post) private readonly postRepo: Repository<Post>,
    @InjectRepository(Hub) private readonly hubRepo: Repository<Hub>,
    @InjectRepository(HubFollow) private readonly hubFollowRepo: Repository<HubFollow>,
    @InjectRepository(UserFollow) private readonly userFollowRepo: Repository<UserFollow>,
    @InjectRepository(List) private readonly listRepo: Repository<List>,
    @InjectRepository(ListItem) private readonly listItemRepo: Repository<ListItem>,
  ) {}

  // Returns up to `limit` posts starting at `offset` of the personalised, ranked
  // feed for this viewer. Caller is responsible for shaping/joining viewer state
  // (likes, reposts) onto these posts.
  async rank(viewerId: string, limit: number, offset: number): Promise<{ posts: Post[]; totalCandidates: number }> {
    const profile = await this.buildProfile(viewerId);
    const candidates = await this.fetchCandidates(profile);
    if (!candidates.length) return { posts: [], totalCandidates: 0 };

    const scored: ScoredPost[] = candidates.map((post) => ({ post, score: this.score(post, profile) }));
    const diverse = this.applyDiversity(scored);

    // First page only: ensure up to `spoilerQuotaFirstPage` spoiler posts are
    // visible without scrolling, distributed through the page (not clumped at
    // the bottom). Spoiler discussion is high-engagement content, and the
    // ranker's spoiler penalty alone would let it sink off the visible page.
    const final = offset === 0 ? this.ensureSpoilersInFirstPage(diverse, limit) : diverse;
    return { posts: final.slice(offset, offset + limit).map((s) => s.post), totalCandidates: final.length };
  }

  private ensureSpoilersInFirstPage(list: ScoredPost[], pageSize: number): ScoredPost[] {
    const target = W.spoilerQuotaFirstPage;
    if (target <= 0 || list.length <= pageSize) return list;

    const visibleSpoilers = list.slice(0, pageSize).filter((s) => s.post.hasSpoiler).length;
    const needed = target - visibleSpoilers;
    if (needed <= 0) return list;

    // Highest-ranked spoilers currently outside the page (already in score order).
    const outsideIdxs: number[] = [];
    for (let i = pageSize; i < list.length && outsideIdxs.length < needed; i++) {
      if (list[i].post.hasSpoiler) outsideIdxs.push(i);
    }
    if (outsideIdxs.length === 0) return list;

    // Pop them out (descending so earlier indices stay stable).
    const reordered = [...list];
    const lifted: ScoredPost[] = [];
    for (let i = outsideIdxs.length - 1; i >= 0; i--) {
      lifted.unshift(reordered.splice(outsideIdxs[i], 1)[0]);
    }

    // Distribute through the page at evenly spaced positions, skipping slot 0
    // so the most personalised top result is preserved. For pageSize=10 and
    // lifted.length=3 this places spoilers at slots 2, 5, 7.
    for (let k = 0; k < lifted.length; k++) {
      const slot = Math.floor((pageSize * (k + 1)) / (lifted.length + 1));
      const insertAt = Math.min(Math.max(slot, 1), reordered.length);
      reordered.splice(insertAt, 0, lifted[k]);
    }
    return reordered;
  }

  // ── Profile ──────────────────────────────────────────────────────────────────

  private async buildProfile(viewerId: string): Promise<ViewerProfile> {
    const [hubFollows, userFollows, ownedLists] = await Promise.all([
      this.hubFollowRepo.find({ where: { userId: viewerId }, select: ['hubId'] }),
      this.userFollowRepo.find({ where: { followerId: viewerId }, select: ['followingId'] }),
      this.listRepo.find({ where: { userId: viewerId } }),
    ]);

    const listIdToBucket = new Map<string, ListBucket>();
    for (const l of ownedLists) {
      if (l.listType === 'watchlist' || l.listType === 'watched' || l.listType === 'favorites') {
        listIdToBucket.set(l.id, l.listType);
      }
    }

    const watchlistHubs = new Set<string>();
    const watchedHubs = new Set<string>();
    const favoriteHubs = new Set<string>();

    if (listIdToBucket.size) {
      const items = await this.listItemRepo.find({ where: { listId: In([...listIdToBucket.keys()]) } });
      for (const item of items) {
        const bucket = listIdToBucket.get(item.listId);
        if (bucket === 'watchlist') watchlistHubs.add(item.hubId);
        else if (bucket === 'watched') watchedHubs.add(item.hubId);
        else if (bucket === 'favorites') favoriteHubs.add(item.hubId);
      }
    }

    const followedHubs = new Set(hubFollows.map((h) => h.hubId));
    const followedUsers = new Set(userFollows.map((f) => f.followingId));

    const genreWeights = await this.buildGenreWeights(followedHubs, favoriteHubs, watchedHubs);

    return { viewerId, followedHubs, followedUsers, watchlistHubs, watchedHubs, favoriteHubs, genreWeights };
  }

  private async buildGenreWeights(
    followedHubs: Set<string>,
    favoriteHubs: Set<string>,
    watchedHubs: Set<string>,
  ): Promise<Map<string, number>> {
    const tasteHubs = new Set<string>([...followedHubs, ...favoriteHubs, ...watchedHubs]);
    if (!tasteHubs.size) return new Map();

    const hubs = await this.hubRepo.find({ where: { id: In([...tasteHubs]) }, select: ['id', 'genres'] });
    const counts = new Map<string, number>();
    for (const h of hubs) {
      if (!h.genres) continue;
      // A hub the user explicitly favorited counts more than one they merely follow.
      const weight =
        (favoriteHubs.has(h.id) ? 2 : 0) + (followedHubs.has(h.id) ? 1 : 0) + (watchedHubs.has(h.id) ? 1 : 0);
      if (weight === 0) continue;
      for (const g of this.parseGenres(h.genres)) {
        counts.set(g, (counts.get(g) ?? 0) + weight);
      }
    }
    if (!counts.size) return new Map();
    const max = Math.max(...counts.values());
    const normalized = new Map<string, number>();
    for (const [g, c] of counts) normalized.set(g, c / max);
    return normalized;
  }

  private parseGenres(raw: string): string[] {
    return raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0);
  }

  // ── Candidate generation ─────────────────────────────────────────────────────

  // SQLite stores datetimes in "YYYY-MM-DD HH:MM:SS.sss" local-time format via
  // TypeORM. Date.toISOString() uses "T" + UTC, which lexicographically misaligns
  // at day boundaries — so format the comparison date the same way the column does.
  private formatSqliteDate(d: Date): string {
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
    );
  }

  // Pull together a few hundred posts the viewer might plausibly like, from a
  // handful of pools (interested hubs, followed users, globally trending). The
  // ranker scores this pool — it's the cap on how much work we do per request.
  private async fetchCandidates(profile: ViewerProfile): Promise<Post[]> {
    const since = this.formatSqliteDate(new Date(Date.now() - W.candidateWindowDays * 24 * 3600 * 1000));
    const trendingSince = this.formatSqliteDate(new Date(Date.now() - W.trendingWindowDays * 24 * 3600 * 1000));

    const interestedHubIds = new Set<string>([
      ...profile.followedHubs,
      ...profile.watchlistHubs,
      ...profile.watchedHubs,
      ...profile.favoriteHubs,
    ]);

    const seen = new Set<string>();
    const out: Post[] = [];
    const absorb = (rows: Post[]) => {
      for (const r of rows) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        out.push(r);
      }
    };

    // Every candidate-pool query excludes the viewer's own posts: a user has
    // already seen what they wrote, and the feed is meant for discovery.
    const excludeSelf = (qb: ReturnType<typeof this.postRepo.createQueryBuilder>) =>
      qb.andWhere('post.userId != :viewerId', { viewerId: profile.viewerId });

    if (interestedHubIds.size) {
      const rows = await excludeSelf(
        this.postRepo
          .createQueryBuilder('post')
          .leftJoinAndSelect('post.author', 'author')
          .leftJoinAndSelect('post.hub', 'hub')
          .where('post.hubId IN (:...hubIds)', { hubIds: [...interestedHubIds] })
          .andWhere('post.createdAt >= :since', { since }),
      )
        .orderBy('post.createdAt', 'DESC')
        .take(W.poolInterestedHubs)
        .getMany();
      absorb(rows);
    }

    if (profile.followedUsers.size) {
      const rows = await excludeSelf(
        this.postRepo
          .createQueryBuilder('post')
          .leftJoinAndSelect('post.author', 'author')
          .leftJoinAndSelect('post.hub', 'hub')
          .where('post.userId IN (:...userIds)', { userIds: [...profile.followedUsers] })
          .andWhere('post.createdAt >= :since', { since }),
      )
        .orderBy('post.createdAt', 'DESC')
        .take(W.poolFollowedUsers)
        .getMany();
      absorb(rows);
    }

    {
      // Globally trending pool — top engagement-scored posts in the last
      // `trendingWindowDays`, no hub restriction. The split affinity floor
      // (explicit match → 0.5, no match → 0.05) is what keeps these from
      // muscling above personalised content; we don't need to pre-filter the
      // pool any more.
      const rows = await excludeSelf(
        this.postRepo
          .createQueryBuilder('post')
          .leftJoinAndSelect('post.author', 'author')
          .leftJoinAndSelect('post.hub', 'hub')
          .where('post.createdAt >= :since', { since: trendingSince }),
      )
        .addSelect('(post.likes_count * 3 + post.reposts_count * 2 + post.comments_count)', 'score')
        .orderBy('score', 'DESC')
        .addOrderBy('post.createdAt', 'DESC')
        .take(W.poolGloballyTrending)
        .getMany();
      absorb(rows);
    }

    {
      // Broad-recent pool — supplies the long tail so the feed supports
      // endless scroll. Without this, a viewer with a small interested-hubs
      // profile would hit "all caught up" after a few pages. These posts get
      // the small floor (no explicit match), so they only surface once the
      // user has scrolled past their personalised content.
      const rows = await excludeSelf(
        this.postRepo
          .createQueryBuilder('post')
          .leftJoinAndSelect('post.author', 'author')
          .leftJoinAndSelect('post.hub', 'hub')
          .where('post.createdAt >= :since', { since }),
      )
        .orderBy('post.createdAt', 'DESC')
        .take(W.poolBroadRecent)
        .getMany();
      absorb(rows);
    }

    // Cold start: literally no posts in the last 30 days. Fall through to the
    // most recent posts ever so the feed is never empty.
    if (!out.length) {
      const rows = await excludeSelf(
        this.postRepo
          .createQueryBuilder('post')
          .leftJoinAndSelect('post.author', 'author')
          .leftJoinAndSelect('post.hub', 'hub')
          .where('1 = 1'),
      )
        .orderBy('post.createdAt', 'DESC')
        .take(W.poolColdStart)
        .getMany();
      absorb(rows);
    }

    return out;
  }

  // ── Scoring ──────────────────────────────────────────────────────────────────

  private score(post: Post, profile: ViewerProfile): number {
    const ageHours = Math.max(0, (Date.now() - new Date(post.createdAt).getTime()) / 3600000);
    const freshness = Math.exp(-ageHours / W.freshnessHalfLifeHours);

    // Log-dampened so a single viral post doesn't crush everything else. The
    // leading +1 ensures a brand-new post (zero engagement) still has engagement >= 1
    // — without it, log(1+0)=0 zeroes the whole product and a post from the user's
    // favourite hub loses to an unrelated post just because no one's liked it yet.
    const engagement =
      1 +
      Math.log(
        1 +
          W.engagementLike * post.likesCount +
          W.engagementRepost * post.repostsCount +
          W.engagementComment * post.commentsCount,
      );

    // Track *explicit* signals separately from genre overlap. Only an explicit
    // signal (the viewer told us they care about this hub or author) qualifies
    // a post for the generous matched floor. Genre overlap is circumstantial:
    // a single TV-show genre tag like "Sci-Fi & Fantasy" landing in the genre
    // weights shouldn't be enough to lift an unrelated viral post into the
    // user's main feed. Genre still contributes to the affinity score, just
    // not to the floor decision.
    let affinity = 0;
    let hasExplicitMatch = false;
    if (profile.followedHubs.has(post.hubId)) {
      affinity += W.affinityFollowsHub;
      hasExplicitMatch = true;
    }
    if (profile.favoriteHubs.has(post.hubId)) {
      affinity += W.affinityFavoriteHub;
      hasExplicitMatch = true;
    }
    if (profile.watchlistHubs.has(post.hubId)) {
      affinity += W.affinityWatchlistHub;
      hasExplicitMatch = true;
    }
    if (profile.watchedHubs.has(post.hubId)) {
      affinity += W.affinityWatchedHub;
      hasExplicitMatch = true;
    }
    if (profile.followedUsers.has(post.userId)) {
      affinity += W.affinityFollowsAuthor;
      hasExplicitMatch = true;
    }

    if (post.hub?.genres && profile.genreWeights.size) {
      let genreScore = 0;
      for (const g of this.parseGenres(post.hub.genres)) {
        const w = profile.genreWeights.get(g);
        if (w !== undefined && w > genreScore) genreScore = w;
      }
      affinity += W.affinityGenre * genreScore;
    }

    const authorFollowers = post.author?.followersCount ?? 0;
    const authorBoost = Math.log(1 + authorFollowers) * W.authorBoost;

    // Hide spoilers for things the viewer hasn't logged as watched. Don't hard-filter —
    // they may still want to see it, just below other posts.
    const spoilerPenalty =
      post.hasSpoiler && !profile.watchedHubs.has(post.hubId) ? W.spoilerPenaltyUnwatched : 1.0;

    // Floor controls tie-breaking among unmatched posts (so they rank against
    // each other by engagement × freshness, not all collapse to score = 0).
    // The match BONUS is the load-bearing piece: a flat +5 added to explicitly
    // matched posts so a day-old fresh off-hub viral post (which the
    // multiplicative form alone treats as score ≈ engagement) cannot outrank a
    // 10-day-old low-engagement in-hub post (multiplicative score ≈ 0.1).
    const floor = hasExplicitMatch ? W.affinityFloor : W.affinityFloorNoMatch;
    const matchBonus = hasExplicitMatch ? W.affinityMatchBonus : 0;
    const base = (affinity + floor) * engagement * freshness + matchBonus;
    return (base + authorBoost) * spoilerPenalty;
  }

  // ── Diversity ────────────────────────────────────────────────────────────────

  // Greedy re-rank: pick the highest-scoring candidate, decay subsequent posts
  // from the same hub or same author so the feed isn't 5 posts from one hub in a
  // row. O(n²) over candidates — fine for ~300 candidates per request.
  private applyDiversity(scored: ScoredPost[]): ScoredPost[] {
    const remaining = [...scored];
    const out: ScoredPost[] = [];
    const hubSeen = new Map<string, number>();
    const authorSeen = new Map<string, number>();

    while (remaining.length) {
      let bestIdx = 0;
      let bestAdj = -Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const p = remaining[i].post;
        const hc = hubSeen.get(p.hubId) ?? 0;
        const ac = authorSeen.get(p.userId) ?? 0;
        const adj =
          remaining[i].score *
          Math.pow(W.diversityHubDecay, hc) *
          Math.pow(W.diversityAuthorDecay, ac);
        if (adj > bestAdj) {
          bestAdj = adj;
          bestIdx = i;
        }
      }
      const picked = remaining.splice(bestIdx, 1)[0];
      out.push({ post: picked.post, score: bestAdj });
      hubSeen.set(picked.post.hubId, (hubSeen.get(picked.post.hubId) ?? 0) + 1);
      authorSeen.set(picked.post.userId, (authorSeen.get(picked.post.userId) ?? 0) + 1);
    }
    return out;
  }
}

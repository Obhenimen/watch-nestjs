# For You Feed — Ranking Algorithm

This document explains how the personalised "For You" feed at `GET /posts/feed`
ranks posts so that each user sees content they're more likely to engage with
(and, ultimately, more likely to **watch the movie or series being discussed**).

It covers:

1. What changed and why
2. The data signals we use
3. The pipeline (candidate generation → scoring → diversity → pagination)
4. The full scoring formula, term by term
5. How to tune it
6. Cold start, edge cases, and limits
7. Where to take it next

---

## 1. What changed

**Before.** `GET /posts/feed` returned posts only from hubs the viewer follows,
sorted strictly by `createdAt DESC`. Two users who follow the same hubs saw the
exact same feed in the same order.

**After.** Every viewer gets a personalised, ranked feed. Two users who follow
the same hubs but have different watchlists, favourites, or follow different
authors will see different posts in different orders. The endpoint, request
shape, and response shape are unchanged — only the ordering and the candidate
set are different.

**Files involved:**

- `src/posts/feed-ranking.service.ts` — new ranking service (candidate pool,
  scoring, diversity).
- `src/posts/posts.service.ts` — `getFeed()` now delegates to the ranker.
- `src/posts/posts.module.ts` — registers `FeedRankingService` and the extra
  repositories it needs (`UserFollow`, `List`, `ListItem`).

---

## 2. Signals used

All of these already exist in the database — no schema changes were required.

| Signal                        | Source                                         | What it tells us                          |
| ----------------------------- | ---------------------------------------------- | ----------------------------------------- |
| Followed hubs                 | `hub_follows`                                  | Strongest declared interest in a title    |
| Favourite hubs                | `lists` (type=`favorites`) → `list_items`      | Strongest implicit love                   |
| Watchlist hubs                | `lists` (type=`watchlist`) → `list_items`      | "I want to watch this" — high intent      |
| Watched hubs                  | `lists` (type=`watched`) → `list_items`        | Past consumption — taste signal           |
| Followed authors              | `user_follows`                                 | Trust in a poster                         |
| Genre affinity                | Hubs above × `title_hubs.genres`               | Generalises taste beyond specific titles  |
| Engagement counts             | `posts.likes_count / reposts_count / comments_count` | Quality / popularity of the post itself |
| Recency                       | `posts.created_at`                             | Freshness                                 |
| Author authority              | `users.followers_count`                        | Tie-breaker for novel authors             |
| Spoiler flag                  | `posts.has_spoiler`                            | Avoid spoiling unwatched titles           |

---

## 3. Pipeline

For each `GET /posts/feed` request:

```
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│ 1. Build viewer  │   │ 2. Generate      │   │ 3. Score every   │   │ 4. Diversify &   │
│    profile       │──▶│    candidate     │──▶│    candidate     │──▶│    paginate      │
│ (follows, lists, │   │    pool          │   │ (affinity ×      │   │ (penalise repeats│
│  genres)         │   │ (~150–300 posts) │   │  engagement ×    │   │  of same hub /   │
│                  │   │                  │   │  freshness)      │   │  same author)    │
└──────────────────┘   └──────────────────┘   └──────────────────┘   └──────────────────┘
```

### 3.1 Viewer profile

We build a small in-memory profile per request:

- `followedHubs`, `favoriteHubs`, `watchlistHubs`, `watchedHubs` — `Set<string>`
- `followedUsers` — `Set<string>`
- `genreWeights` — `Map<genre, weight∈[0,1]>` derived from the hubs above

Genre weights come from counting how often each genre appears across the
viewer's followed/favourite/watched hubs, with favourites weighted ×2 and the
others ×1, then normalising to `[0, 1]` by dividing by the max count.

### 3.2 Candidate pool

We pull candidates from three pools, dedupe, and stop. We never score every
post in the database — that would be O(N) per request and won't scale.

| Pool                  | Window  | Cap | Source                                            |
| --------------------- | ------- | --- | ------------------------------------------------- |
| Interested hubs       | 30 days | 150 | Posts in any followed / favourite / watchlist / watched hub |
| Followed authors      | 30 days |  80 | Posts by any user the viewer follows              |
| In-profile trending   | 14 days |  60 | Top posts by `likes×3 + reposts×2 + comments`, **restricted to the viewer's interested hubs** when they have a profile — falls back to unfiltered trending only on cold start |

If all three pools come up empty (a brand-new user when the community is
quiet), we fall back to the 60 most recent posts so the feed is never empty.
This is the **cold start** path.

### 3.3 Scoring

Each candidate gets a single floating-point score. See §4 for the exact formula.

### 3.4 Diversity

Sorting purely by raw score tends to put 4 posts from the hottest hub of the
week back-to-back. We re-rank with a greedy decay: each time we pick a post
from a hub or author we've already shown, the next candidate from that same
hub/author is multiplied by `0.6` (hub) or `0.7` (author). Picks compound, so
the third post from the same hub is multiplied by `0.6² ≈ 0.36`.

This is O(n²) over the candidate pool, which is fine because the pool is
capped at a few hundred.

### 3.4b Spoiler quota (first page only)

The scoring stage applies a small (0.85) multiplier to spoiler posts about
unwatched titles. That demotes them slightly but isn't enough to keep them
off the page on its own — and even at the previous 0.7 multiplier, it
sometimes pushed every spoiler past the fold. Spoiler discussion is
high-engagement content; a feed with zero visible spoilers feels lifeless.

So, on the **first page only** (when the request has `offset = 0`), we
guarantee up to `spoilerQuotaFirstPage` (default **3**) spoiler posts are
visible, distributed through the page rather than clumped at the bottom.
For a 10-slot page that means spoilers around positions 2, 5, and 7.
Slot 0 is always reserved for the highest-affinity personalised pick.

How it works:

1. Count how many spoilers already landed in the visible slice naturally.
2. If that's already at the quota, do nothing.
3. Otherwise, lift the top-ranked spoilers from outside the page (in score
   order) until either the quota is met or the candidate pool runs out.
4. Splice the lifted spoilers into evenly-spaced slots in the visible page.

If the pool genuinely contains zero spoiler posts, the quota is a
no-op — we never fabricate one. Subsequent pages don't enforce this:
spoilers there fall out of natural ranking, and re-shuffling them on every
"load more" would feel arbitrary.

### 3.5 Pagination

The cursor is a stringified offset into the diversified, ranked list. The
client passes the `nextCursor` from the previous page back as `cursor`.
Candidates are regenerated on every request, so a refresh always reflects the
latest state — the offset only meaningfully drives "load more" within a
single session.

---

## 4. Scoring formula

For each candidate post:

```
score = (affinity + 0.5) × engagement × freshness  +  authorBoost
score = score × spoilerPenalty
```

### Affinity — *does this viewer care about this hub or author?*

```
affinity =
    0.5 · followsHub
  + 0.4 · favoriteHub
  + 0.3 · watchlistHub
  + 0.2 · watchedHub
  + 0.4 · followsAuthor
  + 0.2 · maxGenreOverlap     ∈ [0, 1]
```

Each predicate is 0 or 1 except `maxGenreOverlap`, which picks the strongest
matching genre weight from the viewer's profile. A post can hit multiple
predicates at once (e.g. you follow the hub AND the author AND it's a
favourite genre).

The outer formula uses a **split affinity floor** that hinges on *explicit*
signals only:

```
hasExplicitMatch = followedHub || favoriteHub || watchlistHub
                 || watchedHub  || followedAuthor
floor = hasExplicitMatch ? affinityFloor (0.5) : affinityFloorNoMatch (0.05)
```

Note the asymmetry: **genre overlap does not count toward the floor
decision** even though it does add to the affinity score. The reason is a
real bug we hit — TMDB has both "Science Fiction" (movie tag) and "Sci-Fi
& Fantasy" (TV tag), and one TV show in the user's hubs put "sci-fi &
fantasy" in their genre profile with weight ~0.4. That was enough for an
unrelated viral comedy tagged "Sci-Fi & Fantasy" to score in the matched
bucket. The split-floor-on-explicit-only formulation lets genre still tilt
ranking *within* a bucket (a genre-matched post outscores a totally random
one) without granting the bucket promotion.

Posts with no explicit match drop to a 0.05 floor. They can still surface,
but they need very high engagement and freshness to compete with content
the viewer has actually indicated interest in.

For cold-start users (no profile data) every post is in the "no match"
bucket, so every candidate gets the small floor. Relative ranking among
them is unchanged — they still order by engagement × freshness — only the
absolute scores are smaller.

### Engagement — *is this post good?*

```
engagement = log(1 + 3·likesCount + 2·repostsCount + 1.5·commentsCount)
```

Likes are cheap, reposts mean someone re-shared (stronger), comments mean
someone took time to type. We log-dampen so a single viral post doesn't
crush everything else.

### Freshness — *is this post recent?*

```
freshness = exp(-ageHours / 36)
```

Half-life of ~25 hours (because `e^(-24/36) ≈ 0.51`). A 1-day-old post is
worth half as much as a brand-new one; a 3-day-old post is worth ~13%.

### Author boost

```
authorBoost = log(1 + author.followersCount) × 0.1
```

Added (not multiplied) so it acts as a small tie-breaker for novel content
from established posters, without dominating the affinity term.

### Spoiler penalty

```
spoilerPenalty = (post.hasSpoiler && !watchedHubs.has(post.hubId)) ? 0.7 : 1.0
```

Posts marked as spoilers for hubs the viewer hasn't watched are demoted by
30% — not hidden outright, since the viewer might still want to see them.

---

## 5. Tuning

All weights live as `const W = { ... }` at the top of
`src/posts/feed-ranking.service.ts`. The most useful knobs:

| Knob                         | Default | Effect of raising                                   |
| ---------------------------- | ------- | --------------------------------------------------- |
| `freshnessHalfLifeHours`     | 36      | Older posts survive longer (good for slow communities) |
| `affinityFloor`              | 0.5     | Floor for posts that match the viewer in any way    |
| `affinityFloorNoMatch`       | 0.05    | Floor for zero-match posts; raise → more serendipity / off-genre virality |
| `engagementLike` etc.        | 3/2/1.5 | Re-weight like vs repost vs comment                 |
| `diversityHubDecay`          | 0.6     | Stronger penalty → more variety, fewer repeat hubs  |
| `poolGloballyTrending`       | 60      | Larger trending pool → more discovery, slower request |
| `candidateWindowDays`        | 30      | Wider candidate window → more posts to rank, older  |
| `spoilerPenaltyUnwatched`    | 0.85    | Lower → harsher spoiler hiding                      |
| `spoilerQuotaFirstPage`      | 3       | How many spoilers to guarantee on the first page    |

When changing weights, watch:

- **Candidate count** — should stay in the low hundreds. If it explodes, the
  request gets slow because diversity is O(n²).
- **Top-of-feed variety** — eyeball the first 20 posts for diversity of hub,
  author, and freshness.

---

## 6. Cold start, edge cases, limits

**Brand-new viewer, no follows or lists.** The first two pools produce
nothing; the trending pool fills the feed. As soon as they like or follow
anything, the personalised pools kick in.

**Quiet community.** All windowed pools come up empty → fall back to the 60
most recent posts (no time filter). The user still gets a feed.

**Spoilers.** Demoted, not removed. The viewer can still see them at the
bottom of the page.

**Self-authored posts.** Currently treated like any other candidate. We
considered hiding them but chose not to — your own posts in your feed is
useful confirmation they went out.

**Limits this implementation does NOT address (yet):**

- **No view tracking.** We rank on likes/reposts/comments only. Most viewers
  don't engage explicitly, so we're missing the largest signal — actual
  views, dwell time, video watch percentage.
- **No "not interested" feedback.** Once a post is shown, we have no way to
  know the viewer skipped it.
- **No collaborative filtering.** We don't compute "users similar to you also
  liked X" — only first-order signals (your own follows, your own lists).
- **Diversity is greedy O(n²).** Fine at ~300 candidates; would need to be
  reconsidered if pools grow into the thousands.
- **No request-level caching.** Each request rebuilds the profile and pool.
  At low traffic this is fine; at scale, cache the profile and the trending
  pool for ~60s.

---

## 7. Roadmap

The order matters — each step compounds off the previous one:

1. **Add a `post_views` table** (`postId`, `userId`, `viewedAt`, `dwellMs`,
   `videoWatchedPct`). Every other improvement gets better with this signal.
2. **Add a "not interested" / mute action** so we can subtract a strong
   negative signal from candidates.
3. **Switch hand-tuned weights to a learned model.** Train a logistic
   regression on `(features → did_user_engage)` using the views table. Same
   pipeline, learned weights instead of guessed ones.
4. **Cache the candidate pool.** Memoise the global-trending pool by minute,
   per-user candidate set by request — both are easy wins.
5. **Collaborative filtering.** Once you have view data, compute
   user/hub embeddings and add an "embedding similarity" term to the affinity
   sum.

Until step 1 lands, the heuristic in this document is the right level of
sophistication: it uses every signal currently available, and no more.

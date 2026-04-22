# App Database Schema

A SQLite schema for a movie/TV social platform where users follow title hubs, write posts (with text, images, or video), comment, like, repost, and manage collections through a unified lists system.

---

## Table of Contents

1. [Overview](#overview)
2. [Schema Changelog](#schema-changelog)
3. [SQLite Notes](#sqlite-notes)
4. [Entities](#entities)
   - [users](#users)
   - [title_hubs](#title_hubs)
   - [posts](#posts)
   - [comments](#comments)
   - [likes](#likes)
   - [comment_likes](#comment_likes)
   - [reposts](#reposts)
   - [user_follows](#user_follows)
   - [hub_follows](#hub_follows)
   - [lists](#lists)
   - [list_items](#list_items)
   - [notifications](#notifications)
5. [Lists System — How It Works](#lists-system--how-it-works)
6. [Hub Sorting — Trending, New, Top](#hub-sorting--trending-new-top)
7. [Post Sorting — Trending, New, Top](#post-sorting--trending-new-top)
8. [Relationships Summary](#relationships-summary)
9. [Backend Implementation Guide](#backend-implementation-guide)
   - [Project Structure](#project-structure)
   - [Database Connection Setup](#database-connection-setup)
   - [UUID Generation](#uuid-generation)
   - [Authentication](#authentication)
   - [Transactions — Atomic Operations](#transactions--atomic-operations)
   - [Denormalized Count Strategy](#denormalized-count-strategy)
   - [For You Feed Query](#for-you-feed-query)
   - [Cursor-Based Pagination](#cursor-based-pagination)
   - [Trending Score Background Job](#trending-score-background-job)
   - [File Uploads — Images and Video](#file-uploads--images-and-video)
   - [Notifications — When to Create Them](#notifications--when-to-create-them)
10. [Indexes](#indexes)
11. [Full SQL](#full-sql)

---

## Overview

The platform is built around **Title Hubs** — one hub per movie or TV show. Users follow hubs to see posts in their feed. Every post belongs to exactly one hub and one user. Posts support text, images, and video. Comments are threaded. Social interactions are recorded in dedicated junction tables.

Users manage collections through a unified **Lists** system — default lists (Watchlist, Watched, Favorites) and custom lists share the same `lists` table.

---

## Schema Changelog

Issues found during review and what was fixed:

| Issue | Fix |
|---|---|
| `comments.likes_count` existed but no junction table to track who liked which comment | Added `comment_likes` table |
| `users` had no auth fields — no way to log in | Added `email` and `password_hash` to `users` |
| No `notifications` table despite bell icon with unread badge visible in UI | Added `notifications` table |
| `idx_posts_hub_id` and `idx_posts_hub_recent` were identical indexes | Removed duplicate `idx_posts_hub_id` |
| No `updated_at` on `posts` or `comments` — can't track edits | Added nullable `updated_at` to both |

---

## SQLite Notes

- **IDs** are `TEXT` UUIDs. SQLite has no native UUID type — generate them in application code.
- **Booleans** are `INTEGER`: `0` = false, `1` = true.
- **Timestamps** are `TEXT` in ISO 8601 format: `"2024-11-01T14:32:00Z"`. This allows lexicographic sorting.
- **Foreign keys are OFF by default.** Run `PRAGMA foreign_keys = ON;` on every connection open.
- **WAL mode** should be enabled for concurrent reads. Run `PRAGMA journal_mode = WAL;` once at setup.
- **Denormalized counts** (`followers_count`, `likes_count`, etc.) are stored on parent rows for fast reads. Sync them in application code — see the Denormalized Count Strategy section.
- **Default lists** must be created in application code when a user registers — SQLite has no stored procedures to do this automatically.

---

## Entities

---

### `users`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | UUID |
| `email` | TEXT | NOT NULL, UNIQUE | Login email address |
| `password_hash` | TEXT | NOT NULL | Bcrypt or Argon2 hash — never store plain text |
| `username` | TEXT | NOT NULL, UNIQUE | Public handle shown as `@username` |
| `display_name` | TEXT | NOT NULL | Name shown on profile |
| `bio` | TEXT | | Short profile bio |
| `avatar_url` | TEXT | | URL to profile picture |
| `followers_count` | INTEGER | NOT NULL, DEFAULT 0 | Denormalized |
| `following_count` | INTEGER | NOT NULL, DEFAULT 0 | Denormalized |
| `created_at` | TEXT | NOT NULL | ISO 8601 timestamp |

**Note:** If using an external auth provider (Supabase Auth, Firebase Auth, Clerk), replace `email` and `password_hash` with a single `auth_provider_id TEXT NOT NULL UNIQUE` column that stores the external UID. The rest of the table stays the same.

**On user creation:** Insert the user row, then immediately insert three default list rows inside the same transaction — see the Lists System section.

---

### `title_hubs`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | UUID |
| `name` | TEXT | NOT NULL | e.g. `"Dune: Part Two"` |
| `year` | INTEGER | | Release year |
| `type` | TEXT | NOT NULL | `'movie'` or `'series'` |
| `genres` | TEXT | | Comma-separated, e.g. `"Sci-Fi, Adventure"` |
| `director` | TEXT | | Director or showrunner name |
| `icon_url` | TEXT | | Small square icon |
| `backdrop_url` | TEXT | | Wide backdrop for hub detail page |
| `description` | TEXT | | Synopsis paragraph |
| `followers_count` | INTEGER | NOT NULL, DEFAULT 0 | Denormalized |
| `posts_count` | INTEGER | NOT NULL, DEFAULT 0 | Denormalized |
| `trending_score` | INTEGER | NOT NULL, DEFAULT 0 | Recalculated by background job |
| `created_at` | TEXT | NOT NULL | ISO 8601 timestamp |

---

### `posts`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | UUID |
| `user_id` | TEXT | NOT NULL, FK → users.id | Author |
| `hub_id` | TEXT | NOT NULL, FK → title_hubs.id | Hub this post belongs to |
| `title` | TEXT | | Optional headline |
| `body` | TEXT | NOT NULL | Main text content |
| `media_type` | TEXT | NOT NULL, DEFAULT `'none'` | `'none'`, `'image'`, or `'video'` |
| `image_url` | TEXT | | When `media_type = 'image'` |
| `video_url` | TEXT | | When `media_type = 'video'` |
| `video_thumbnail_url` | TEXT | | Video preview frame |
| `video_duration_secs` | INTEGER | | Video length in seconds |
| `has_spoiler` | INTEGER | NOT NULL, DEFAULT 0 | `1` = blur until tapped |
| `likes_count` | INTEGER | NOT NULL, DEFAULT 0 | Denormalized |
| `reposts_count` | INTEGER | NOT NULL, DEFAULT 0 | Denormalized |
| `comments_count` | INTEGER | NOT NULL, DEFAULT 0 | Denormalized |
| `created_at` | TEXT | NOT NULL | ISO 8601 |
| `updated_at` | TEXT | | Set when post is edited; NULL means never edited |

**Media rule:** `media_type` is the source of truth. `'none'` → all media columns NULL. `'image'` → only `image_url` set. `'video'` → `video_url`, `video_thumbnail_url`, and `video_duration_secs` set.

---

### `comments`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | UUID |
| `post_id` | TEXT | NOT NULL, FK → posts.id | The post |
| `user_id` | TEXT | NOT NULL, FK → users.id | The commenter |
| `parent_id` | TEXT | FK → comments.id | NULL = top-level; non-null = reply |
| `body` | TEXT | NOT NULL | Comment text |
| `likes_count` | INTEGER | NOT NULL, DEFAULT 0 | Denormalized — synced via `comment_likes` |
| `created_at` | TEXT | NOT NULL | ISO 8601 |
| `updated_at` | TEXT | | Set when comment is edited |

`parent_id` is self-referencing. The UI renders one level deep ("View all N replies") but the schema supports any depth.

---

### `likes`

Records a user liking a post. Composite primary key prevents double-liking.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `user_id` | TEXT | NOT NULL, FK → users.id | |
| `post_id` | TEXT | NOT NULL, FK → posts.id | |
| `created_at` | TEXT | NOT NULL | |

Primary key: `(user_id, post_id)`. On insert → `posts.likes_count + 1`. On delete → `posts.likes_count - 1`.

---

### `comment_likes`

Records a user liking a comment. Without this table you cannot: (a) show whether the current user has liked a comment, or (b) prevent double-liking.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `user_id` | TEXT | NOT NULL, FK → users.id | |
| `comment_id` | TEXT | NOT NULL, FK → comments.id | |
| `created_at` | TEXT | NOT NULL | |

Primary key: `(user_id, comment_id)`. On insert → `comments.likes_count + 1`. On delete → `comments.likes_count - 1`.

---

### `reposts`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `user_id` | TEXT | NOT NULL, FK → users.id | |
| `post_id` | TEXT | NOT NULL, FK → posts.id | |
| `created_at` | TEXT | NOT NULL | |

Primary key: `(user_id, post_id)`. On insert → `posts.reposts_count + 1`. On delete → `posts.reposts_count - 1`.

---

### `user_follows`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `follower_id` | TEXT | NOT NULL, FK → users.id | |
| `following_id` | TEXT | NOT NULL, FK → users.id | |
| `created_at` | TEXT | NOT NULL | |

Primary key: `(follower_id, following_id)`. CHECK: `follower_id != following_id`.

On insert → increment `following_count` on follower AND `followers_count` on followed. Reverse on delete.

---

### `hub_follows`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `user_id` | TEXT | NOT NULL, FK → users.id | |
| `hub_id` | TEXT | NOT NULL, FK → title_hubs.id | |
| `created_at` | TEXT | NOT NULL | |

Primary key: `(user_id, hub_id)`. On insert → `title_hubs.followers_count + 1`. On delete → decrement.

---

### `lists`

Unified table for all collections — default lists (Watchlist, Watched, Favorites) and custom user lists.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | UUID |
| `user_id` | TEXT | NOT NULL, FK → users.id | Owner |
| `list_type` | TEXT | NOT NULL | `'watchlist'`, `'watched'`, `'favorites'`, or `'custom'` |
| `name` | TEXT | NOT NULL | e.g. `"Horror Classics"` |
| `emoji` | TEXT | | e.g. `"👻"` |
| `description` | TEXT | | Optional description |
| `is_default` | INTEGER | NOT NULL, DEFAULT 0 | `1` = cannot be deleted or renamed |
| `is_public` | INTEGER | NOT NULL, DEFAULT 0 | `1` = visible to other users |
| `items_count` | INTEGER | NOT NULL, DEFAULT 0 | Denormalized |
| `created_at` | TEXT | NOT NULL | ISO 8601 |

A partial unique index on `(user_id, list_type) WHERE is_default = 1` guarantees each user has exactly one of each default list type.

---

### `list_items`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `list_id` | TEXT | NOT NULL, FK → lists.id | |
| `hub_id` | TEXT | NOT NULL, FK → title_hubs.id | |
| `status` | TEXT | | `'watching'`, `'watch_next'`, or NULL. Only meaningful for `list_type = 'watchlist'`. |
| `added_at` | TEXT | NOT NULL | ISO 8601 |

Primary key: `(list_id, hub_id)`. On insert → `lists.items_count + 1`. On delete → decrement.

---

### `notifications`

Records activity that should trigger an alert for a user (the bell icon).

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | UUID |
| `recipient_id` | TEXT | NOT NULL, FK → users.id | The user receiving the notification |
| `actor_id` | TEXT | NOT NULL, FK → users.id | The user who performed the action |
| `type` | TEXT | NOT NULL | See notification types below |
| `post_id` | TEXT | FK → posts.id | Set for post-related notifications |
| `comment_id` | TEXT | FK → comments.id | Set for comment-related notifications |
| `hub_id` | TEXT | FK → title_hubs.id | Set for hub-related notifications |
| `is_read` | INTEGER | NOT NULL, DEFAULT 0 | `0` = unread (shows red dot), `1` = read |
| `created_at` | TEXT | NOT NULL | ISO 8601 |

**Notification types:**

| `type` value | When it fires | Fields set |
|---|---|---|
| `'post_like'` | Someone likes your post | `post_id`, `actor_id` |
| `'post_repost'` | Someone reposts your post | `post_id`, `actor_id` |
| `'post_comment'` | Someone comments on your post | `post_id`, `comment_id`, `actor_id` |
| `'comment_reply'` | Someone replies to your comment | `post_id`, `comment_id`, `actor_id` |
| `'comment_like'` | Someone likes your comment | `comment_id`, `actor_id` |
| `'user_follow'` | Someone follows you | `actor_id` |

**Rules:**
- Never create a notification where `recipient_id = actor_id` — users should not be notified of their own actions.
- The unread badge count is `SELECT COUNT(*) FROM notifications WHERE recipient_id = ? AND is_read = 0`.
- Mark all as read with `UPDATE notifications SET is_read = 1 WHERE recipient_id = ?` when the user opens the notifications screen.

---

## Lists System — How It Works

### On user registration (inside a transaction)

```sql
BEGIN;

INSERT INTO users (id, email, password_hash, username, display_name, created_at)
VALUES (:id, :email, :hash, :username, :display_name, :now);

INSERT INTO lists (id, user_id, list_type, name, emoji, is_default, is_public, created_at)
VALUES
  (uuid(), :id, 'watchlist', 'Watchlist', '📌', 1, 0, :now),
  (uuid(), :id, 'watched',   'Watched',   '✅', 1, 0, :now),
  (uuid(), :id, 'favorites', 'Favorites', '❤️', 1, 0, :now);

COMMIT;
```

### Profile — Watchlist tab queries

| UI Tab | Query |
|---|---|
| All | Items in the `'watchlist'` default list, no status filter |
| Watching | Items in `'watchlist'` where `status = 'watching'` |
| Watch Next | Items in `'watchlist'` where `status = 'watch_next'` |
| Watched | Items in the `'watched'` default list (separate list entirely) |

### My Lists screen queries

```sql
-- Default lists (fixed display order)
SELECT * FROM lists
WHERE user_id = ? AND is_default = 1
ORDER BY CASE list_type
  WHEN 'watchlist'  THEN 1
  WHEN 'watched'    THEN 2
  WHEN 'favorites'  THEN 3
END;

-- Custom lists
SELECT * FROM lists
WHERE user_id = ? AND list_type = 'custom'
ORDER BY created_at DESC;
```

---

## Hub Sorting — Trending, New, Top

| Tab | Query |
|---|---|
| Trending | `ORDER BY trending_score DESC` |
| New | `ORDER BY created_at DESC` |
| Top | `ORDER BY followers_count DESC` |

`trending_score` is pre-computed by a background job — see the Trending Score Background Job section.

---

## Post Sorting — Trending, New, Top

Post counts are already denormalized on each row, so all three sorts run inline — no background job needed.

| Tab | Query |
|---|---|
| New | `ORDER BY created_at DESC` |
| Top | `ORDER BY likes_count DESC` |
| Trending | Weighted formula with recency window — see below |

```sql
-- Trending posts in a hub (last 30 days, weighted engagement)
SELECT *,
  (likes_count * 3 + reposts_count * 2 + comments_count * 1) AS score
FROM posts
WHERE hub_id = :hub_id
  AND created_at >= datetime('now', '-30 days')
ORDER BY score DESC
LIMIT 20;
```

Adjust `-30 days` to `-7 days` for faster-moving trends.

---

## Relationships Summary

| Relationship | Type | Description |
|---|---|---|
| users → posts | one-to-many | A user writes many posts |
| users → comments | one-to-many | A user writes many comments |
| users → likes | one-to-many | A user likes many posts |
| users → comment_likes | one-to-many | A user likes many comments |
| users → reposts | one-to-many | A user reposts many posts |
| users → user_follows (follower) | one-to-many | A user follows many users |
| users → user_follows (following) | one-to-many | A user is followed by many users |
| users → hub_follows | one-to-many | A user follows many hubs |
| users → lists | one-to-many | A user owns many lists |
| users → notifications (recipient) | one-to-many | A user receives many notifications |
| title_hubs → posts | one-to-many | A hub contains many posts |
| title_hubs → hub_follows | one-to-many | A hub has many followers |
| title_hubs → list_items | one-to-many | A hub appears in many lists |
| posts → comments | one-to-many | A post has many comments |
| posts → likes | one-to-many | A post receives many likes |
| posts → reposts | one-to-many | A post is reposted many times |
| posts → notifications | one-to-many | A post triggers many notifications |
| comments → comments | self one-to-many | A comment has many replies |
| comments → comment_likes | one-to-many | A comment receives many likes |
| lists → list_items | one-to-many | A list contains many hubs |

---

## Backend Implementation Guide

This section explains how to implement the difficult parts of the backend correctly.

---

### Project Structure

```
/
├── db/
│   ├── schema.sql          ← the Full SQL block from this README
│   ├── connection.js       ← opens SQLite, sets PRAGMAs, exports db instance
│   └── migrations/         ← future schema changes as numbered SQL files
├── services/
│   ├── auth.js             ← register, login, token handling
│   ├── users.js            ← profile reads and writes
│   ├── posts.js            ← create, read, delete, like, repost
│   ├── comments.js         ← create, read, delete, like, thread fetch
│   ├── hubs.js             ← hub reads, follow/unfollow, search
│   ├── lists.js            ← list CRUD, add/remove hub from list
│   ├── feed.js             ← For You feed assembly
│   ├── notifications.js    ← create and read notifications
│   └── trending.js         ← background job for hub trending_score
├── routes/
│   └── ...                 ← HTTP route handlers that call services
└── middleware/
    ├── auth.js             ← JWT verification middleware
    └── pagination.js       ← cursor extraction from query params
```

Keep each service focused on one entity. Routes should be thin — they validate input, call a service function, and return the result.

---

### Database Connection Setup

Run these PRAGMAs every time you open a connection. In most frameworks this means running them once at app startup on the single shared connection.

```js
const db = new Database('app.sqlite'); // using better-sqlite3

db.pragma('journal_mode = WAL');     // allows concurrent reads while writing
db.pragma('foreign_keys = ON');      // enforce FK constraints
db.pragma('busy_timeout = 5000');    // wait up to 5s if DB is locked, don't crash
db.pragma('synchronous = NORMAL');   // safe with WAL, faster than FULL
db.pragma('cache_size = -20000');    // 20MB page cache in memory
db.pragma('temp_store = MEMORY');    // store temp tables in memory
```

**Use `better-sqlite3` (Node.js) or the equivalent synchronous driver for your language.** SQLite is not designed for async concurrent writes — a single synchronous connection with WAL mode handles all writes safely without connection pools.

---

### UUID Generation

SQLite has no built-in UUID function. Generate UUIDs in application code before every INSERT.

```js
// Node.js (built-in, no package needed)
const id = crypto.randomUUID(); // "550e8400-e29b-41d4-a716-446655440000"
```

Set a helper so every service uses the same function:

```js
// db/helpers.js
export const uuid = () => crypto.randomUUID();
export const now  = () => new Date().toISOString();
```

Then every INSERT looks like:

```js
import { uuid, now } from '../db/helpers.js';

db.prepare(`
  INSERT INTO posts (id, user_id, hub_id, body, media_type, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`).run(uuid(), userId, hubId, body, mediaType, now());
```

---

### Authentication

**Never store plain text passwords.** Hash with `bcrypt` or `argon2` before inserting.

```js
import bcrypt from 'bcrypt';

// Registration
const password_hash = await bcrypt.hash(plainPassword, 12); // 12 = cost factor
db.prepare(`INSERT INTO users (..., password_hash) VALUES (?, ...)`).run(..., password_hash);

// Login
const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);
const valid = await bcrypt.compare(plainPassword, user.password_hash);
if (!valid) throw new Error('Invalid credentials');
```

**Issue JWTs** after successful login. The JWT payload should contain only `{ sub: user.id, username: user.username }`. Never put sensitive data in a JWT payload — it is base64-encoded, not encrypted.

```js
import jwt from 'jsonwebtoken';

const token = jwt.sign(
  { sub: user.id, username: user.username },
  process.env.JWT_SECRET,
  { expiresIn: '30d' }
);
```

Your auth middleware should verify this token and attach `req.user = { id, username }` before hitting any protected route.

---

### Transactions — Atomic Operations

Several operations touch multiple tables. If any step fails, all steps must roll back together. **Wrap these in transactions:**

**1. User registration** — insert user + insert 3 default lists
**2. Follow a user** — insert `user_follows` + update two `users` counts
**3. Like a post** — insert `likes` + update `posts.likes_count` + insert `notifications`
**4. Create a post** — insert `posts` + increment `title_hubs.posts_count`
**5. Delete a post** — delete `posts` + decrement `title_hubs.posts_count`

```js
// better-sqlite3 transactions are synchronous and very fast
const likePost = db.transaction((userId, postId, postOwnerId) => {
  db.prepare(`
    INSERT INTO likes (user_id, post_id, created_at) VALUES (?, ?, ?)
  `).run(userId, postId, now());

  db.prepare(`
    UPDATE posts SET likes_count = likes_count + 1 WHERE id = ?
  `).run(postId);

  // Don't notify yourself
  if (userId !== postOwnerId) {
    db.prepare(`
      INSERT INTO notifications (id, recipient_id, actor_id, type, post_id, created_at)
      VALUES (?, ?, ?, 'post_like', ?, ?)
    `).run(uuid(), postOwnerId, userId, postId, now());
  }
});

// Call it — if anything throws, the whole transaction rolls back automatically
likePost(currentUserId, postId, postOwnerId);
```

---

### Denormalized Count Strategy

Counts like `posts.likes_count` and `title_hubs.followers_count` are stored directly on the row so they can be read with zero joins. The tradeoff is you must keep them accurate yourself.

**Rule: always update the count in the same transaction as the INSERT or DELETE that changes it.**

Never rely on a periodic sync job to fix counts — your UI will show stale numbers to users. Do it atomically every time.

If a count ever drifts out of sync (e.g. during a bug), run a repair query:

```sql
-- Repair posts.likes_count
UPDATE posts SET likes_count = (
  SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id
);

-- Repair title_hubs.followers_count
UPDATE title_hubs SET followers_count = (
  SELECT COUNT(*) FROM hub_follows WHERE hub_follows.hub_id = title_hubs.id
);
```

---

### For You Feed Query

The "For You" feed shows posts from all hubs the current user follows, ordered by recency.

```sql
SELECT
  p.*,
  u.username,
  u.display_name,
  u.avatar_url,
  h.name   AS hub_name,
  h.icon_url AS hub_icon,
  -- Is the current user's like recorded?
  EXISTS(
    SELECT 1 FROM likes l
    WHERE l.post_id = p.id AND l.user_id = :current_user_id
  ) AS liked_by_me,
  -- Is the current user's repost recorded?
  EXISTS(
    SELECT 1 FROM reposts r
    WHERE r.post_id = p.id AND r.user_id = :current_user_id
  ) AS reposted_by_me
FROM posts p
JOIN users u        ON u.id = p.user_id
JOIN title_hubs h   ON h.id = p.hub_id
WHERE p.hub_id IN (
  SELECT hub_id FROM hub_follows WHERE user_id = :current_user_id
)
ORDER BY p.created_at DESC
LIMIT 20;
```

The `liked_by_me` and `reposted_by_me` subqueries let the client immediately render the correct heart/repost toggle state without a second request.

---

### Cursor-Based Pagination

**Do not use `OFFSET` pagination** (`LIMIT 20 OFFSET 40`). It gets slower with every page as the database scans more rows, and it produces duplicate or missing items when new posts are inserted mid-scroll.

Use **cursor-based pagination** instead. The cursor is the `created_at` timestamp of the last item the client received.

```js
// First page — no cursor
GET /feed

// Subsequent pages — pass last item's created_at as cursor
GET /feed?cursor=2024-11-01T14:32:00Z
```

```sql
-- First page (no cursor)
SELECT ... FROM posts
WHERE hub_id IN (SELECT hub_id FROM hub_follows WHERE user_id = ?)
ORDER BY created_at DESC
LIMIT 21; -- fetch 21, return 20, use the 21st to detect hasNextPage

-- Subsequent pages (with cursor)
SELECT ... FROM posts
WHERE hub_id IN (SELECT hub_id FROM hub_follows WHERE user_id = ?)
  AND created_at < :cursor   -- strictly before the cursor
ORDER BY created_at DESC
LIMIT 21;
```

Return the response like this:

```json
{
  "posts": [...20 items...],
  "nextCursor": "2024-10-28T09:14:22Z",
  "hasNextPage": true
}
```

`nextCursor` is the `created_at` of the 20th item. `hasNextPage` is true if 21 rows were returned.

---

### Trending Score Background Job

The `title_hubs.trending_score` column needs to be refreshed periodically. This is a background job — not an API endpoint. Run it on a cron schedule (e.g. every hour).

```js
// services/trending.js

export function recalculateTrendingScores() {
  const scores = db.prepare(`
    SELECT
      h.id,
      (
        COUNT(DISTINCT hf.user_id) * 10 +
        COUNT(DISTINCT p.id)       * 5  +
        COUNT(DISTINCT l.user_id)  * 2  +
        COUNT(DISTINCT c.id)       * 1
      ) AS score
    FROM title_hubs h
    LEFT JOIN hub_follows hf ON hf.hub_id = h.id
      AND hf.created_at >= datetime('now', '-7 days')
    LEFT JOIN posts p ON p.hub_id = h.id
      AND p.created_at >= datetime('now', '-7 days')
    LEFT JOIN likes l ON l.post_id = p.id
      AND l.created_at >= datetime('now', '-7 days')
    LEFT JOIN comments c ON c.post_id = p.id
      AND c.created_at >= datetime('now', '-7 days')
    GROUP BY h.id
  `).all();

  const update = db.prepare(
    `UPDATE title_hubs SET trending_score = ? WHERE id = ?`
  );

  const updateAll = db.transaction(() => {
    for (const row of scores) {
      update.run(row.score, row.id);
    }
  });

  updateAll();
  console.log(`Trending scores updated for ${scores.length} hubs`);
}

// Schedule with node-cron (or any cron library)
import cron from 'node-cron';
cron.schedule('0 * * * *', recalculateTrendingScores); // every hour
```

**Weighting guide:**
- New follower (`×10`) — strongest signal of intent
- New post (`×5`) — signals active community discussion
- Like (`×2`) — engagement but cheap action
- Comment (`×1`) — engagement, can be positive or negative

Adjust the `-7 days` window and weights to tune how fast trends rise and fall.

---

### File Uploads — Images and Video

SQLite stores file paths (`image_url`, `video_url`), not the binary files themselves. Files must be uploaded to external object storage first, then the URL is saved in the database.

**Recommended flow:**

```
Client → POST /upload/presign → Server generates a presigned S3/R2/Supabase Storage URL
Client → PUT <presigned_url> (direct upload from device, not through your server)
Client → POST /posts (body includes the returned public URL)
Server → INSERT into posts with the file URL
```

This keeps large files off your server entirely.

**For `video_thumbnail_url`:** Generate a thumbnail server-side after the video is uploaded using `ffmpeg`. A common approach: a cloud function triggered by the storage bucket on new video uploads that extracts the first frame and saves it alongside the video.

---

### Notifications — When to Create Them

Create a notification row inside the same transaction as the action that triggers it. Never create a notification when `actor_id = recipient_id`.

| User action | Notification type | Recipient |
|---|---|---|
| Like a post | `post_like` | `posts.user_id` |
| Repost a post | `post_repost` | `posts.user_id` |
| Comment on a post | `post_comment` | `posts.user_id` |
| Reply to a comment | `comment_reply` | `comments.user_id` (the parent comment's author) |
| Like a comment | `comment_like` | `comments.user_id` |
| Follow a user | `user_follow` | `following_id` |

**Unread badge count:**

```sql
SELECT COUNT(*) AS unread
FROM notifications
WHERE recipient_id = :user_id AND is_read = 0;
```

**Mark all read** when user opens the notifications screen:

```sql
UPDATE notifications SET is_read = 1
WHERE recipient_id = :user_id AND is_read = 0;
```

---

## Indexes

```sql
-- Post feed queries
CREATE INDEX idx_posts_hub_recent       ON posts(hub_id, created_at DESC);
CREATE INDEX idx_posts_hub_likes        ON posts(hub_id, likes_count DESC);
CREATE INDEX idx_posts_user_id          ON posts(user_id, created_at DESC);

-- Comment threading
CREATE INDEX idx_comments_post_id       ON comments(post_id, created_at ASC);
CREATE INDEX idx_comments_parent_id     ON comments(parent_id);

-- Interaction lookups (did current user like/repost?)
CREATE INDEX idx_likes_post_id          ON likes(post_id);
CREATE INDEX idx_reposts_post_id        ON reposts(post_id);
CREATE INDEX idx_comment_likes_comment  ON comment_likes(comment_id);

-- Social graph
CREATE INDEX idx_user_follows_follower  ON user_follows(follower_id);
CREATE INDEX idx_user_follows_following ON user_follows(following_id);
CREATE INDEX idx_hub_follows_user       ON hub_follows(user_id);
CREATE INDEX idx_hub_follows_hub        ON hub_follows(hub_id);

-- Lists system
CREATE INDEX idx_lists_user_id          ON lists(user_id, list_type);
CREATE INDEX idx_list_items_list_id     ON list_items(list_id, added_at DESC);
CREATE INDEX idx_list_items_hub_id      ON list_items(hub_id);

-- Hub discovery tabs
CREATE INDEX idx_title_hubs_trending    ON title_hubs(trending_score DESC);
CREATE INDEX idx_title_hubs_new         ON title_hubs(created_at DESC);
CREATE INDEX idx_title_hubs_top         ON title_hubs(followers_count DESC);

-- Notifications
CREATE INDEX idx_notifications_recipient ON notifications(recipient_id, is_read, created_at DESC);
```

---

## Full SQL

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;

-- ─────────────────────────────────────────
-- USERS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id               TEXT    PRIMARY KEY,
  email            TEXT    NOT NULL UNIQUE,
  password_hash    TEXT    NOT NULL,
  username         TEXT    NOT NULL UNIQUE,
  display_name     TEXT    NOT NULL,
  bio              TEXT,
  avatar_url       TEXT,
  followers_count  INTEGER NOT NULL DEFAULT 0,
  following_count  INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT    NOT NULL
);

-- ─────────────────────────────────────────
-- TITLE HUBS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS title_hubs (
  id               TEXT    PRIMARY KEY,
  name             TEXT    NOT NULL,
  year             INTEGER,
  type             TEXT    NOT NULL CHECK(type IN ('movie', 'series')),
  genres           TEXT,
  director         TEXT,
  icon_url         TEXT,
  backdrop_url     TEXT,
  description      TEXT,
  followers_count  INTEGER NOT NULL DEFAULT 0,
  posts_count      INTEGER NOT NULL DEFAULT 0,
  trending_score   INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT    NOT NULL
);

-- ─────────────────────────────────────────
-- POSTS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS posts (
  id                    TEXT    PRIMARY KEY,
  user_id               TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hub_id                TEXT    NOT NULL REFERENCES title_hubs(id) ON DELETE CASCADE,
  title                 TEXT,
  body                  TEXT    NOT NULL,
  media_type            TEXT    NOT NULL DEFAULT 'none'
                                CHECK(media_type IN ('none', 'image', 'video')),
  image_url             TEXT,
  video_url             TEXT,
  video_thumbnail_url   TEXT,
  video_duration_secs   INTEGER,
  has_spoiler           INTEGER NOT NULL DEFAULT 0 CHECK(has_spoiler IN (0, 1)),
  likes_count           INTEGER NOT NULL DEFAULT 0,
  reposts_count         INTEGER NOT NULL DEFAULT 0,
  comments_count        INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT    NOT NULL,
  updated_at            TEXT
);

-- ─────────────────────────────────────────
-- COMMENTS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comments (
  id           TEXT    PRIMARY KEY,
  post_id      TEXT    NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id      TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id    TEXT    REFERENCES comments(id) ON DELETE SET NULL,
  body         TEXT    NOT NULL,
  likes_count  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL,
  updated_at   TEXT
);

-- ─────────────────────────────────────────
-- LIKES (post likes)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS likes (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id     TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, post_id)
);

-- ─────────────────────────────────────────
-- COMMENT LIKES
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comment_likes (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment_id  TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, comment_id)
);

-- ─────────────────────────────────────────
-- REPOSTS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reposts (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id     TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, post_id)
);

-- ─────────────────────────────────────────
-- USER FOLLOWS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_follows (
  follower_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (follower_id, following_id),
  CHECK(follower_id != following_id)
);

-- ─────────────────────────────────────────
-- HUB FOLLOWS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hub_follows (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hub_id      TEXT NOT NULL REFERENCES title_hubs(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, hub_id)
);

-- ─────────────────────────────────────────
-- LISTS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lists (
  id           TEXT    PRIMARY KEY,
  user_id      TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  list_type    TEXT    NOT NULL
               CHECK(list_type IN ('watchlist', 'watched', 'favorites', 'custom')),
  name         TEXT    NOT NULL,
  emoji        TEXT,
  description  TEXT,
  is_default   INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0, 1)),
  is_public    INTEGER NOT NULL DEFAULT 0 CHECK(is_public IN (0, 1)),
  items_count  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_default_list_type
  ON lists(user_id, list_type)
  WHERE is_default = 1;

-- ─────────────────────────────────────────
-- LIST ITEMS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS list_items (
  list_id   TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  hub_id    TEXT NOT NULL REFERENCES title_hubs(id) ON DELETE CASCADE,
  status    TEXT CHECK(status IN ('watching', 'watch_next')),
  added_at  TEXT NOT NULL,
  PRIMARY KEY (list_id, hub_id)
);

-- ─────────────────────────────────────────
-- NOTIFICATIONS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id            TEXT    PRIMARY KEY,
  recipient_id  TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id      TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT    NOT NULL CHECK(type IN (
                  'post_like', 'post_repost', 'post_comment',
                  'comment_reply', 'comment_like', 'user_follow'
                )),
  post_id       TEXT    REFERENCES posts(id) ON DELETE CASCADE,
  comment_id    TEXT    REFERENCES comments(id) ON DELETE CASCADE,
  hub_id        TEXT    REFERENCES title_hubs(id) ON DELETE CASCADE,
  is_read       INTEGER NOT NULL DEFAULT 0 CHECK(is_read IN (0, 1)),
  created_at    TEXT    NOT NULL
);

-- ─────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_posts_hub_recent        ON posts(hub_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_hub_likes         ON posts(hub_id, likes_count DESC);
CREATE INDEX IF NOT EXISTS idx_posts_user_id           ON posts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_post_id        ON comments(post_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_comments_parent_id      ON comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_likes_post_id           ON likes(post_id);
CREATE INDEX IF NOT EXISTS idx_reposts_post_id         ON reposts(post_id);
CREATE INDEX IF NOT EXISTS idx_comment_likes_comment   ON comment_likes(comment_id);
CREATE INDEX IF NOT EXISTS idx_user_follows_follower   ON user_follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_user_follows_following  ON user_follows(following_id);
CREATE INDEX IF NOT EXISTS idx_hub_follows_user        ON hub_follows(user_id);
CREATE INDEX IF NOT EXISTS idx_hub_follows_hub         ON hub_follows(hub_id);
CREATE INDEX IF NOT EXISTS idx_lists_user_id           ON lists(user_id, list_type);
CREATE INDEX IF NOT EXISTS idx_list_items_list_id      ON list_items(list_id, added_at DESC);
CREATE INDEX IF NOT EXISTS idx_list_items_hub_id       ON list_items(hub_id);
CREATE INDEX IF NOT EXISTS idx_title_hubs_trending     ON title_hubs(trending_score DESC);
CREATE INDEX IF NOT EXISTS idx_title_hubs_new          ON title_hubs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_title_hubs_top          ON title_hubs(followers_count DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id, is_read, created_at DESC);
```
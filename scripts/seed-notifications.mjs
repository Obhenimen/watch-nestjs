/**
 * seed-notifications.mjs — populate the `notifications` table with realistic
 * dummy rows for every user.
 *
 * Run via npm script:
 *   npm run db:populate-notifications
 *
 * Env vars:
 *   DB_PATH     default ./data/watchcue.sqlite
 *   PER_USER    default 12 — notifications created per recipient
 *   RESET       "1" to delete all existing notifications before seeding
 */

import Database from 'better-sqlite3';
import crypto from 'crypto';

const DB_PATH = process.env.DB_PATH ?? './data/watchcue.sqlite';
const PER_USER = parseInt(process.env.PER_USER ?? '12', 10);
const RESET = process.env.RESET === '1';

const uuid = () => crypto.randomUUID();

// Types the backend understands (see notification.entity.ts).
const TYPES = [
  'post_like',
  'post_repost',
  'post_comment',
  'comment_reply',
  'comment_like',
  'user_follow',
];

function weightedPickType() {
  // Weights chosen so the feed feels realistic — mostly likes/comments,
  // occasional follows/reposts.
  const weighted = [
    ['post_like', 4],
    ['post_comment', 3],
    ['comment_like', 3],
    ['comment_reply', 2],
    ['user_follow', 2],
    ['post_repost', 1],
  ];
  const total = weighted.reduce((a, [, w]) => a + w, 0);
  let r = Math.random() * total;
  for (const [t, w] of weighted) {
    r -= w;
    if (r <= 0) return t;
  }
  return weighted[0][0];
}

function randomMinutesAgoIso() {
  // Up to ~14 days, clustered toward the recent end.
  const maxMinutes = 14 * 24 * 60;
  const bias = Math.pow(Math.random(), 2); // squared → skewed toward 0
  const minutes = Math.floor(bias * maxMinutes);
  const d = new Date(Date.now() - minutes * 60_000);
  return d.toISOString().replace('T', ' ').replace('Z', '').slice(0, 23);
}

// ── main ────────────────────────────────────────────────────────────────────

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

const userIds = db.prepare('SELECT id FROM users').all().map((r) => r.id);
if (userIds.length === 0) {
  console.error('  No users found — nothing to seed.');
  process.exit(1);
}

const postRows = db
  .prepare('SELECT id, user_id FROM posts')
  .all();
const commentRows = db
  .prepare('SELECT id, post_id, user_id FROM comments')
  .all();

if (postRows.length === 0 || commentRows.length === 0) {
  console.error(
    '  Need both posts and comments in the DB for a realistic seed. Run db:populate-posts first.',
  );
  process.exit(1);
}

const postsByUser = new Map();
for (const p of postRows) {
  const arr = postsByUser.get(p.user_id) ?? [];
  arr.push(p);
  postsByUser.set(p.user_id, arr);
}
const commentsByUser = new Map();
for (const c of commentRows) {
  const arr = commentsByUser.get(c.user_id) ?? [];
  arr.push(c);
  commentsByUser.set(c.user_id, arr);
}

if (RESET) {
  const del = db.prepare('DELETE FROM notifications').run();
  console.log(`  Deleted ${del.changes} existing notification(s).`);
}

const insert = db.prepare(`
  INSERT INTO notifications (id, recipient_id, actor_id, type, post_id, comment_id, hub_id, is_read, created_at)
  VALUES (@id, @recipient_id, @actor_id, @type, @post_id, @comment_id, @hub_id, @is_read, @created_at)
`);

const seed = db.transaction((rows) => {
  for (const r of rows) insert.run(r);
});

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function otherUser(notId) {
  for (let i = 0; i < 8; i++) {
    const candidate = pickRandom(userIds);
    if (candidate !== notId) return candidate;
  }
  return userIds.find((u) => u !== notId);
}

const allRows = [];
let skipped = 0;

for (const recipientId of userIds) {
  const recipientPosts = postsByUser.get(recipientId) ?? [];
  const recipientComments = commentsByUser.get(recipientId) ?? [];

  let created = 0;
  let attempts = 0;
  while (created < PER_USER && attempts < PER_USER * 4) {
    attempts++;
    const type = weightedPickType();
    const actorId = otherUser(recipientId);
    if (!actorId) break;

    let post_id = null;
    let comment_id = null;
    const hub_id = null;

    if (type === 'post_like' || type === 'post_repost') {
      if (recipientPosts.length === 0) {
        skipped++;
        continue;
      }
      post_id = pickRandom(recipientPosts).id;
    } else if (type === 'post_comment') {
      if (recipientPosts.length === 0) {
        skipped++;
        continue;
      }
      const p = pickRandom(recipientPosts);
      post_id = p.id;
      // Attach a real comment on that post if one exists
      const commentsOnPost = commentRows.filter((c) => c.post_id === p.id);
      if (commentsOnPost.length > 0) {
        comment_id = pickRandom(commentsOnPost).id;
      }
    } else if (type === 'comment_reply' || type === 'comment_like') {
      if (recipientComments.length === 0) {
        skipped++;
        continue;
      }
      const c = pickRandom(recipientComments);
      comment_id = c.id;
      post_id = c.post_id;
    }
    // user_follow → no linked post/comment

    // ~50% of notifications in the last 24h are unread; older: 20%.
    const createdAt = randomMinutesAgoIso();
    const isRecent = Date.now() - new Date(createdAt).getTime() < 24 * 60 * 60_000;
    const is_read = (isRecent ? Math.random() < 0.5 : Math.random() < 0.8) ? 1 : 0;

    allRows.push({
      id: uuid(),
      recipient_id: recipientId,
      actor_id: actorId,
      type,
      post_id,
      comment_id,
      hub_id,
      is_read,
      created_at: createdAt,
    });
    created++;
  }
}

seed(allRows);

console.log(`  Seeded ${allRows.length} notifications across ${userIds.length} users.`);
if (skipped > 0) {
  console.log(`  Skipped ${skipped} attempt(s) where a recipient had no posts/comments to link to.`);
}

const sample = db
  .prepare(
    `SELECT n.type, u1.username AS actor, u2.username AS recipient, n.is_read, n.created_at
       FROM notifications n
       JOIN users u1 ON u1.id = n.actor_id
       JOIN users u2 ON u2.id = n.recipient_id
       ORDER BY n.created_at DESC
       LIMIT 5`,
  )
  .all();
console.log('  Sample:');
for (const s of sample) {
  console.log(
    `    @${s.actor} → @${s.recipient} : ${s.type}${s.is_read ? '' : '  (unread)'}  [${s.created_at}]`,
  );
}

db.close();

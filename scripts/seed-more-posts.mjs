/**
 * seed-more-posts.mjs — generate posts/comments/likes for top-N hubs that
 * currently have no posts. Reuses the seed users and each hub's metadata
 * (name, year, genres, director, description, trailer_key) to make
 * title-specific content.
 *
 * Run:  npm run db:populate-posts
 *
 * Env:
 *   DB_PATH             default ./data/watchcue.sqlite
 *   HUBS                default 2000   (top N by trending_score)
 *   POSTS_PER_HUB       default 8
 *   COMMENTS_PER_POST   default 3
 *   LIKES_PER_POST_MAX  default 30
 */

import Database from 'better-sqlite3';
import crypto from 'crypto';

const DB_PATH            = process.env.DB_PATH ?? './data/watchcue.sqlite';
const HUBS               = parseInt(process.env.HUBS ?? '2000');
const POSTS_PER_HUB      = parseInt(process.env.POSTS_PER_HUB ?? '8');
const COMMENTS_PER_POST  = parseInt(process.env.COMMENTS_PER_POST ?? '3');
const LIKES_PER_POST_MAX = parseInt(process.env.LIKES_PER_POST_MAX ?? '30');

const uuid = () => crypto.randomUUID();
const rnd  = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rndInt = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;

// ── post & comment templates ───────────────────────────────────────────────

function firstSentence(text) {
  if (!text) return '';
  const m = text.match(/^[^.!?]+[.!?]/);
  return m ? m[0].trim() : text.slice(0, 160);
}

function postTemplates(hub) {
  const name     = hub.name;
  const year     = hub.year;
  const type     = hub.type;
  const genreRaw = (hub.genres ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const genre    = (genreRaw[0] ?? (type === 'series' ? 'series' : 'film')).toLowerCase();
  const director = hub.director;
  const desc     = firstSentence(hub.description);

  const t = [
    { title: `${name} is a masterpiece — here's why`, body: `I've watched ${name} ${rndInt(2, 4)} times now and it just keeps giving. ${desc} Every element is working in concert.`, hasSpoiler: 0 },
    { title: `The cinematography in ${name}`, body: `Every frame of ${name} looks composed. ${desc}`, hasSpoiler: 0 },
    { title: `${name} deserves more recognition`, body: `Released ${year ?? 'recently'}, ${name} hasn't gotten the attention it should. ${desc}`, hasSpoiler: 0 },
    { title: `Just watched ${name} — first thoughts`, body: `Late to the party but wow. ${desc} The pacing never lets up.`, hasSpoiler: 0 },
    { title: `${name} is unlike anything else in ${genre}`, body: `Comparing ${name} to other ${genre}s feels unfair. It's doing its own thing entirely.`, hasSpoiler: 0 },
    { title: `The ending of ${name} destroyed me (spoilers)`, body: `Still thinking about that final scene in ${name}. Every small moment earlier was deliberate — I caught a dozen things on rewatch.`, hasSpoiler: 1 },
    { title: `Hot take: ${name} is the best ${genre} of ${year ?? 'this decade'}`, body: `Coming for my crown. ${desc} Prove me wrong.`, hasSpoiler: 0 },
    { title: `Why I keep rewatching ${name}`, body: `Some ${type}s reward repeat viewing. ${name} is one of them. Each pass reveals new layers.`, hasSpoiler: 0 },
    { title: `The score in ${name}`, body: `The music in ${name} does so much narrative work. I've had the soundtrack on loop all week.`, hasSpoiler: 0 },
    { title: `${name} made me feel things I wasn't expecting`, body: `Went in cold. ${desc} Not what I expected at all, and better for it.`, hasSpoiler: 0 },
  ];

  if (director) {
    t.push(
      { title: `${director} outdid themselves on ${name}`, body: `${director}'s work on ${name} is some of the best of their career. Every scene has intention behind it.`, hasSpoiler: 0 },
      { title: `The ${director} touch in ${name}`, body: `You can feel ${director} in every frame of ${name}. The signature style is unmistakable.`, hasSpoiler: 0 },
    );
  }
  if (genreRaw.length > 1) {
    t.push({ title: `${name} blends ${genreRaw[0]} and ${genreRaw[1]} perfectly`, body: `It's rare for a ${type} to pull off this kind of genre-mix. ${name} threads the needle cleanly.`, hasSpoiler: 0 });
  }

  return t;
}

function commentTemplates(hub) {
  const name  = hub.name;
  const genre = (hub.genres ?? '').split(',')[0]?.trim().toLowerCase() ?? 'film';
  return [
    `${name} is genuinely one of the best I've seen in the genre.`,
    `I rewatched ${name} last week — still holds up.`,
    `The atmosphere in ${name} is unmatched.`,
    `Underrated, if you ask me.`,
    `Best ${genre} I've seen in ages.`,
    `Can't believe this isn't talked about more.`,
    `Second viewing changed my whole read on it.`,
    `The score, the framing, the performances — all peak.`,
    `I've been recommending ${name} to everyone I know.`,
    `Still thinking about that ending.`,
    `One of those rare ones where every choice feels intentional.`,
    `The craft on display is really something.`,
    `I wish more ${genre}s were this ambitious.`,
    `Felt like a gut punch in the best way.`,
    `Honestly just beautiful filmmaking.`,
  ];
}

// ── db ─────────────────────────────────────────────────────────────────────

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// Users
const users = db.prepare(`SELECT id FROM users`).all();
if (!users.length) { console.error('No users found. Run npm run db:seed first.'); process.exit(1); }
console.log(`  ${users.length} users available as authors`);

// Target hubs: top N by trending_score, excluding hubs that already have posts
const targetHubs = db.prepare(`
  SELECT id, name, year, type, genres, director, description,
         icon_url, backdrop_url, trailer_key
  FROM title_hubs
  WHERE id NOT IN (SELECT DISTINCT hub_id FROM posts)
  ORDER BY trending_score DESC, followers_count DESC
  LIMIT ?
`).all(HUBS);
console.log(`  ${targetHubs.length} hubs to populate (top ${HUBS} by trending, excluding ones with existing posts)`);

// Prepared statements
const insertPost = db.prepare(`
  INSERT INTO posts (
    id, user_id, hub_id, title, body, media_type, image_url, video_url,
    video_thumbnail_url, video_duration_secs, has_spoiler,
    likes_count, reposts_count, comments_count, created_at, updated_at
  ) VALUES (
    @id, @user_id, @hub_id, @title, @body, @media_type, @image_url, @video_url,
    NULL, NULL, @has_spoiler,
    0, 0, 0, @created_at, NULL
  )
`);

const insertComment = db.prepare(`
  INSERT INTO comments (id, post_id, user_id, parent_id, body, likes_count, created_at, updated_at)
  VALUES (@id, @post_id, @user_id, NULL, @body, 0, @created_at, NULL)
`);

const insertLike = db.prepare(`
  INSERT OR IGNORE INTO likes (user_id, post_id, created_at)
  VALUES (?, ?, ?)
`);

const txPosts    = db.transaction((rows) => { for (const r of rows) insertPost.run(r); });
const txComments = db.transaction((rows) => { for (const r of rows) insertComment.run(r); });
const txLikes    = db.transaction((rows) => { for (const r of rows) insertLike.run(r.userId, r.postId, r.createdAt); });

// ── generate ───────────────────────────────────────────────────────────────

function pickMedia(hub) {
  const r = Math.random();
  if (hub.trailer_key && r < 0.30) {
    return { media_type: 'video', image_url: null, video_url: `https://www.youtube.com/watch?v=${hub.trailer_key}` };
  }
  if (hub.icon_url && r < 0.65) {
    return { media_type: 'image', image_url: r < 0.45 ? hub.icon_url : (hub.backdrop_url ?? hub.icon_url), video_url: null };
  }
  return { media_type: 'none', image_url: null, video_url: null };
}

const now = Date.now();
const postRows    = [];
const commentRows = [];
const likeRows    = [];

console.log('  generating...');

for (const hub of targetHubs) {
  const templates = postTemplates(hub);
  const commentBank = commentTemplates(hub);

  for (let i = 0; i < POSTS_PER_HUB; i++) {
    const tpl = rnd(templates);
    const author = rnd(users);
    const hoursAgo = rndInt(1, 24 * 30); // last 30 days
    const createdAt = new Date(now - hoursAgo * 3600 * 1000).toISOString();
    const media = pickMedia(hub);
    const postId = uuid();

    postRows.push({
      id: postId,
      user_id: author.id,
      hub_id: hub.id,
      title: tpl.title.slice(0, 150),
      body: tpl.body,
      has_spoiler: tpl.hasSpoiler,
      created_at: createdAt,
      ...media,
    });

    // Comments (top-level only)
    for (let c = 0; c < rndInt(1, COMMENTS_PER_POST); c++) {
      const commenter = rnd(users.filter(u => u.id !== author.id));
      if (!commenter) continue;
      const offsetMin = rndInt(5, 60 * 24);
      const cCreatedAt = new Date(new Date(createdAt).getTime() + offsetMin * 60 * 1000).toISOString();
      commentRows.push({
        id: uuid(),
        post_id: postId,
        user_id: commenter.id,
        body: rnd(commentBank),
        created_at: cCreatedAt,
      });
    }

    // Likes (pick random subset of users excluding author)
    const likeCount = rndInt(3, LIKES_PER_POST_MAX);
    const candidates = users.filter(u => u.id !== author.id).sort(() => Math.random() - 0.5).slice(0, likeCount);
    for (const liker of candidates) {
      const offsetMin = rndInt(1, 60 * 24 * 5);
      const lCreatedAt = new Date(new Date(createdAt).getTime() + offsetMin * 60 * 1000).toISOString();
      likeRows.push({ userId: liker.id, postId, createdAt: lCreatedAt });
    }
  }
}

console.log(`  generated: ${postRows.length} posts, ${commentRows.length} comments, ${likeRows.length} likes`);

// ── bulk insert ────────────────────────────────────────────────────────────

console.log('  inserting posts...');
txPosts(postRows);

console.log('  inserting comments...');
txComments(commentRows);

console.log('  inserting likes...');
// Chunk in 5k to avoid huge transactions
for (let i = 0; i < likeRows.length; i += 5000) {
  txLikes(likeRows.slice(i, i + 5000));
}

// ── denormalize ────────────────────────────────────────────────────────────

console.log('  recomputing denormalized counts...');
db.exec(`UPDATE posts SET likes_count = (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id)`);
db.exec(`UPDATE posts SET comments_count = (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id)`);
db.exec(`UPDATE title_hubs SET posts_count = (SELECT COUNT(*) FROM posts WHERE posts.hub_id = title_hubs.id)`);

// ── summary ────────────────────────────────────────────────────────────────

const summary = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM posts)                                   AS total_posts,
    (SELECT COUNT(DISTINCT hub_id) FROM posts)                     AS hubs_with_posts,
    (SELECT COUNT(*) FROM comments)                                AS total_comments,
    (SELECT COUNT(*) FROM likes)                                   AS total_likes,
    (SELECT COUNT(*) FROM posts WHERE media_type = 'video')        AS video_posts,
    (SELECT COUNT(*) FROM posts WHERE video_url LIKE '%youtube%')  AS youtube_posts
`).get();

console.log('');
console.log('  ─────────────────────────────');
console.log(`  Total posts:      ${summary.total_posts}`);
console.log(`  Hubs with posts:  ${summary.hubs_with_posts}`);
console.log(`  Total comments:   ${summary.total_comments}`);
console.log(`  Total likes:      ${summary.total_likes}`);
console.log(`  Video posts:      ${summary.video_posts}`);
console.log(`  YouTube-video:    ${summary.youtube_posts}`);
console.log('  Done.');

db.close();

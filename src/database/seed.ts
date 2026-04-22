/**
 * WatchCue seed script — v3 (revamped schema)
 * Run:  npm run db:seed
 */

import 'reflect-metadata';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { v4 as uuid } from 'uuid';
import { readFileSync } from 'fs';
import { join } from 'path';
import { User } from '../users/entities/user.entity';
import { UserFollow } from '../users/entities/user-follow.entity';
import { Hub } from '../hubs/entities/hub.entity';
import { HubFollow } from '../hubs/entities/hub-follow.entity';
import { Post } from '../posts/entities/post.entity';
import { Like } from '../posts/entities/post-like.entity';
import { Repost } from '../posts/entities/repost.entity';
import { Comment } from '../comments/entities/comment.entity';
import { CommentLike } from '../comments/entities/comment-like.entity';
import { List } from '../lists/entities/list.entity';
import { ListItem } from '../lists/entities/list-item.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { PasswordResetToken } from '../auth/entities/password-reset-token.entity';

// ── Helpers ───────────────────────────────────────────────────────────────────

const rnd = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const rndInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const chunk = <T>(arr: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

// ── Load enriched movie data ──────────────────────────────────────────────────

interface EnrichedMovie {
  tmdbId: number;
  name: string;
  type: 'movie' | 'tv';
  overview: string;
  posterUrl: string;
  backdropUrl: string;
  releaseDate: string;
  rating: number;
  genres: string[];
  cast: { name: string; character: string; headshotUrl: string }[];
  youtubeTrailerId: string | null;
}

const ENRICHED: EnrichedMovie[] = JSON.parse(
  readFileSync(join(__dirname, 'enriched-movies.json'), 'utf-8'),
);

const DOWNLOADED_TRAILER_IDS = [
  '1Vnghdsjmd0', '1g3_cfGNbOs', '2ilzidi_J8Q', '5xH0HfJHsaY', '7d_jQycdQGo',
  '8Q6y1waxlTY', '8hYlB38asDY', '9CiW_DgxCnY', 'BdJKm16Co6M', 'BlS73uqTu8A',
  'Cj9kRq37EoY', 'DzfpyUB60YY', 'EP34Yoxs3FQ', 'EXeTwQWrcwY', 'PLl99DlL6b4',
  'PeLPzXQKvP8', 'RlbR5N6veqw', 'Spik5DZMeN4', 'TEn4MHRZt54', 'W6Mm8Sbe__o',
  'WNhK00zpOOQ', 'Way9Dexny3w', 'XJMuhwVlca4', 'XtFI7SNtVpY', 'YoHD9XEInc0',
  'a8Gx8wiNbs8', 'aStYWD25fAQ', 'bLvqoHBptjg', 'cqGjhVJWtEg', 'dV8zKS2b7QQ',
  'gCcx85zbxz4', 'giXco2jaZ_4', 'mqqft2x_Aa4', 'pBk4NYhWNMM', 'qEVUtrk8_B4',
  'r5X-hFf6Bwo', 's82WBpfnCNM', 'sY1S34973zA', 'tGpTpVyI_OQ', 'uYPbbksJxIg',
  'vKQi3bBA1y8', 'wxN1T1uxQ2g', 'yAZxxqQpSqI', 'zSWdZVtXT7E',
];

const trailerForMovie = new Map<number, string>();
for (const m of ENRICHED) {
  if (m.youtubeTrailerId && DOWNLOADED_TRAILER_IDS.includes(m.youtubeTrailerId)) {
    trailerForMovie.set(m.tmdbId, `/trailers/${m.youtubeTrailerId}.mp4`);
  }
}

// ── Post templates ────────────────────────────────────────────────────────────

function generatePost(movie: EnrichedMovie): { title: string; body: string; hasSpoiler: boolean } {
  const lead = movie.cast[0]?.name ?? 'the lead';
  const genre = movie.genres[0]?.toLowerCase() ?? 'film';
  const templates = [
    { title: `${movie.name} is a masterpiece`, body: `Just finished ${movie.name} for the third time. ${movie.overview} ${lead}'s performance alone is worth it.`, hasSpoiler: false },
    { title: `The cinematography in ${movie.name}`, body: `Every frame in ${movie.name} could be a painting. The visual storytelling is extraordinary.`, hasSpoiler: false },
    { title: `${lead} delivers a career-defining role`, body: `Nothing prepared me for what ${lead} does in ${movie.name}. Go in blind.`, hasSpoiler: false },
    { title: `Can't stop thinking about ${movie.name}`, body: `A week after watching and I still can't shake it. The themes go much deeper than the surface ${genre} story.`, hasSpoiler: false },
    { title: `${movie.name} — the ending changed everything (spoilers)`, body: `The final act recontextualises everything. Every small detail was deliberate. ${lead}'s last scene is devastating.`, hasSpoiler: true },
    { title: `Is ${movie.name} the best ${genre} of the decade?`, body: `Bold claim, but I'll defend it. Rated ${movie.rating.toFixed(1)} for a reason. ${movie.overview}`, hasSpoiler: false },
    { title: `Just watched ${movie.name} for the first time`, body: `I know I'm late but wow. ${movie.overview} The pacing is perfect — not a wasted scene.`, hasSpoiler: false },
  ];
  return rnd(templates);
}

function generateComment(movie: EnrichedMovie): string {
  const lead = movie.cast[0]?.name ?? 'the lead';
  const templates = [
    `${lead}'s performance is genuinely transformative.`,
    `I've watched ${movie.name} three times and each viewing reveals something new.`,
    `The cinematography is unlike anything else in the genre right now.`,
    `The score enhances every scene — I've had it on repeat.`,
    `I didn't expect ${movie.name} to hit me this hard emotionally.`,
    `Second viewing is absolutely worth it. So much additional texture.`,
    `Rated ${movie.rating.toFixed(1)} and honestly it deserves higher.`,
    `The editing is so precise — every cut serves the story.`,
    `I've been recommending this to everyone. Nobody has been disappointed.`,
  ];
  return rnd(templates);
}

// ── User data ─────────────────────────────────────────────────────────────────

const FIRST_NAMES = ['alex', 'sam', 'jordan', 'taylor', 'morgan', 'casey', 'riley', 'quinn', 'avery', 'blake', 'cameron', 'drew', 'evan', 'finley', 'grey', 'harper', 'indigo', 'jamie', 'kendall', 'lane', 'mika', 'noel', 'olive', 'parker', 'reed', 'sage', 'tatum', 'uma', 'vale', 'wren'];
const LAST_HANDLES = ['film', 'cinema', 'screen', 'watch', 'review', 'fan', 'buff', 'critic', 'nerd', 'lover'];
const BIOS = [
  'Watching films since before I could read.',
  'Professional overthinker. Amateur film critic.',
  'If I\'m not at the cinema I\'m thinking about it.',
  'My letterboxd is more honest than my CV.',
  'Obsessed with how stories work and why some don\'t.',
  'Dark rooms and bright screens. That\'s where I live.',
  'The emotional damage has been worth it.',
  'Criterion collection owner, unironically.',
  'I rewatch more than I watch anything new.',
  'Arguing about endings is my love language.',
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Starting WatchCue seed v3…');

  const ds = new DataSource({
    type: 'better-sqlite3',
    database: './data/watchcue.sqlite',
    synchronize: true,
    entities: [
      User, UserFollow, Hub, HubFollow,
      Post, Like, Repost, Comment, CommentLike,
      List, ListItem, Notification, PasswordResetToken,
    ],
    logging: false,
  });

  await ds.initialize();
  console.log('✅ Connected');

  await ds.query('PRAGMA foreign_keys = OFF');
  for (const t of [
    'notifications', 'comment_likes', 'likes', 'reposts', 'comments',
    'posts', 'list_items', 'lists', 'hub_follows', 'user_follows',
    'title_hubs', 'users', 'password_reset_tokens',
  ]) {
    await ds.query(`DELETE FROM ${t}`);
  }
  await ds.query('PRAGMA foreign_keys = ON');
  console.log('🗑️  Cleared existing data');

  // ── Hubs ──────────────────────────────────────────────────────────────────
  const hubRepo = ds.getRepository(Hub);
  const hubs = await hubRepo.save(
    ENRICHED.map((m) =>
      hubRepo.create({
        name: m.name,
        year: m.releaseDate ? parseInt(m.releaseDate.slice(0, 4)) : null,
        type: m.type === 'tv' ? 'series' : 'movie',
        genres: m.genres.join(', '),
        director: null,
        iconUrl: m.posterUrl,
        backdropUrl: m.backdropUrl,
        description: m.overview,
      }),
    ),
  );
  console.log(`✅ Created ${hubs.length} hubs`);

  const hubByTmdbId = new Map(ENRICHED.map((m, i) => [m.tmdbId, hubs[i]]));
  const movieByHub = new Map(hubs.map((h, i) => [h.id, ENRICHED[i]]));

  // ── Users ─────────────────────────────────────────────────────────────────
  const seedHash = await bcrypt.hash('SeedPass123!', 8);
  const userRepo = ds.getRepository(User);
  const listRepo = ds.getRepository(List);
  const usedUsernames = new Set<string>();
  const users: User[] = [];

  for (let i = 0; i < 60; i++) {
    const first = rnd(FIRST_NAMES);
    const last = rnd(LAST_HANDLES);
    let username = `${first}_${last}`;
    if (usedUsernames.has(username)) username = `${username}${rndInt(10, 99)}`;
    usedUsernames.add(username);

    const user = await userRepo.save(
      userRepo.create({
        email: `${username}@watchcue.dev`,
        passwordHash: seedHash,
        username,
        displayName: `${first.charAt(0).toUpperCase() + first.slice(1)} ${last.charAt(0).toUpperCase() + last.slice(1)}`,
        bio: rnd(BIOS),
        avatarUrl: null,
      }),
    );

    await listRepo.save([
      listRepo.create({ userId: user.id, listType: 'watchlist', name: 'Watchlist', emoji: '📌', isDefault: true }),
      listRepo.create({ userId: user.id, listType: 'watched',   name: 'Watched',   emoji: '✅', isDefault: true }),
      listRepo.create({ userId: user.id, listType: 'favorites', name: 'Favorites', emoji: '❤️', isDefault: true }),
    ]);

    users.push(user);
  }
  console.log(`✅ Created ${users.length} users (each with 3 default lists)`);

  // ── Hub follows ───────────────────────────────────────────────────────────
  const hubFollowRepo = ds.getRepository(HubFollow);
  const hubFollowSet = new Set<string>();
  const hubFollows: HubFollow[] = [];

  for (const user of users) {
    const toFollow = hubs.sort(() => Math.random() - 0.5).slice(0, rndInt(5, 20));
    for (const hub of toFollow) {
      const key = `${user.id}:${hub.id}`;
      if (hubFollowSet.has(key)) continue;
      hubFollowSet.add(key);
      hubFollows.push(hubFollowRepo.create({ userId: user.id, hubId: hub.id }));
    }
  }

  for (const batch of chunk(hubFollows, 500)) await hubFollowRepo.save(batch);
  await ds.query(`UPDATE title_hubs SET followers_count = (SELECT COUNT(*) FROM hub_follows WHERE hub_id = title_hubs.id)`);
  console.log(`✅ Created ${hubFollows.length} hub follows`);

  // ── User follows ──────────────────────────────────────────────────────────
  const userFollowRepo = ds.getRepository(UserFollow);
  const userFollowSet = new Set<string>();
  const userFollows: UserFollow[] = [];

  for (const user of users) {
    const toFollow = users.filter(u => u.id !== user.id).sort(() => Math.random() - 0.5).slice(0, rndInt(3, 10));
    for (const target of toFollow) {
      const key = `${user.id}:${target.id}`;
      if (userFollowSet.has(key)) continue;
      userFollowSet.add(key);
      userFollows.push(userFollowRepo.create({ followerId: user.id, followingId: target.id }));
    }
  }

  for (const batch of chunk(userFollows, 500)) await userFollowRepo.save(batch);
  await ds.query(`UPDATE users SET followers_count = (SELECT COUNT(*) FROM user_follows WHERE following_id = users.id)`);
  await ds.query(`UPDATE users SET following_count = (SELECT COUNT(*) FROM user_follows WHERE follower_id = users.id)`);
  console.log(`✅ Created ${userFollows.length} user follows`);

  // ── Posts ─────────────────────────────────────────────────────────────────
  const postRepo = ds.getRepository(Post);
  const allPosts: Post[] = [];

  for (const user of users) {
    const userHubIds = hubFollows.filter(hf => hf.userId === user.id).map(hf => hf.hubId);
    const hubPool = userHubIds.length ? hubs.filter(h => userHubIds.includes(h.id)) : hubs;

    for (let p = 0; p < 15; p++) {
      const hub = rnd(hubPool);
      const movie = movieByHub.get(hub.id);
      if (!movie) continue;

      const content = generatePost(movie);
      const hoursAgo = rndInt(1, 72 * 14);
      const createdAt = new Date(Date.now() - hoursAgo * 3600000);

      const trailerPath = trailerForMovie.get(movie.tmdbId);
      const roll = Math.random();
      let mediaType: 'none' | 'image' | 'video' = 'none';
      let imageUrl: string | null = null;
      let videoUrl: string | null = null;

      if (trailerPath && roll < 0.35) {
        mediaType = 'video';
        videoUrl = trailerPath;
      } else if (roll < 0.75) {
        mediaType = 'image';
        imageUrl = roll < 0.55 ? movie.posterUrl : movie.backdropUrl;
      }

      allPosts.push(
        postRepo.create({
          userId: user.id,
          hubId: hub.id,
          title: content.title,
          body: content.body,
          hasSpoiler: content.hasSpoiler,
          mediaType,
          imageUrl,
          videoUrl,
          createdAt,
        }),
      );
    }
  }

  for (const batch of chunk(allPosts, 300)) await postRepo.save(batch);
  await ds.query(`UPDATE title_hubs SET posts_count = (SELECT COUNT(*) FROM posts WHERE hub_id = title_hubs.id)`);
  console.log(`✅ Created ${allPosts.length} posts`);

  // ── Likes ─────────────────────────────────────────────────────────────────
  const likeRepo = ds.getRepository(Like);
  const likeSet = new Set<string>();
  const allLikes: Like[] = [];

  for (const user of users) {
    const likeablePosts = allPosts
      .filter(p => p.userId !== user.id)
      .sort(() => Math.random() - 0.5)
      .slice(0, rndInt(30, 80));

    for (const post of likeablePosts) {
      const key = `${user.id}:${post.id}`;
      if (likeSet.has(key)) continue;
      likeSet.add(key);
      allLikes.push(likeRepo.create({ userId: user.id, postId: post.id }));
    }
  }

  for (const batch of chunk(allLikes, 500)) await likeRepo.save(batch);
  await ds.query(`UPDATE posts SET likes_count = (SELECT COUNT(*) FROM likes WHERE post_id = posts.id)`);
  console.log(`✅ Created ${allLikes.length} likes`);

  // ── Reposts ───────────────────────────────────────────────────────────────
  const repostRepo = ds.getRepository(Repost);
  const repostSet = new Set<string>();
  const allReposts: Repost[] = [];

  for (const user of users) {
    const repostable = allPosts
      .filter(p => p.userId !== user.id)
      .sort(() => Math.random() - 0.5)
      .slice(0, rndInt(5, 20));

    for (const post of repostable) {
      const key = `${user.id}:${post.id}`;
      if (repostSet.has(key)) continue;
      repostSet.add(key);
      allReposts.push(repostRepo.create({ userId: user.id, postId: post.id }));
    }
  }

  for (const batch of chunk(allReposts, 500)) await repostRepo.save(batch);
  await ds.query(`UPDATE posts SET reposts_count = (SELECT COUNT(*) FROM reposts WHERE post_id = posts.id)`);
  console.log(`✅ Created ${allReposts.length} reposts`);

  // ── Comments ──────────────────────────────────────────────────────────────
  const commentRepo = ds.getRepository(Comment);
  const allComments: Comment[] = [];

  for (const post of allPosts) {
    const movie = movieByHub.get(post.hubId);
    if (!movie) continue;

    const otherUsers = users.filter(u => u.id !== post.userId);
    const topLevel: Comment[] = [];

    for (let c = 0; c < rndInt(3, 8); c++) {
      const author = rnd(otherUsers);
      const createdAt = new Date(post.createdAt.getTime() + rndInt(5 * 60000, 48 * 3600000));
      const comment = commentRepo.create({
        postId: post.id,
        userId: author.id,
        parentId: null,
        body: generateComment(movie),
        createdAt,
      });
      topLevel.push(comment);
      allComments.push(comment);
    }

    for (let r = 0; r < rndInt(1, 4); r++) {
      if (!topLevel.length) break;
      const parent = rnd(topLevel);
      const author = rnd(otherUsers);
      const createdAt = new Date(parent.createdAt.getTime() + rndInt(60000, 12 * 3600000));
      allComments.push(
        commentRepo.create({
          postId: post.id,
          userId: author.id,
          parentId: parent.id,
          body: generateComment(movie),
          createdAt,
        }),
      );
    }
  }

  for (const batch of chunk(allComments, 500)) await commentRepo.save(batch);
  await ds.query(`UPDATE posts SET comments_count = (SELECT COUNT(*) FROM comments WHERE post_id = posts.id)`);
  console.log(`✅ Created ${allComments.length} comments`);

  // ── Comment likes ─────────────────────────────────────────────────────────
  const clRepo = ds.getRepository(CommentLike);
  const clSet = new Set<string>();
  const allCLikes: CommentLike[] = [];

  for (const user of users) {
    const likeableComments = allComments
      .filter(c => c.userId !== user.id)
      .sort(() => Math.random() - 0.5)
      .slice(0, rndInt(10, 40));

    for (const comment of likeableComments) {
      const key = `${user.id}:${comment.id}`;
      if (clSet.has(key)) continue;
      clSet.add(key);
      allCLikes.push(clRepo.create({ userId: user.id, commentId: comment.id }));
    }
  }

  for (const batch of chunk(allCLikes, 500)) await clRepo.save(batch);
  await ds.query(`UPDATE comments SET likes_count = (SELECT COUNT(*) FROM comment_likes WHERE comment_id = comments.id)`);
  console.log(`✅ Created ${allCLikes.length} comment likes`);

  // ── Trending scores ───────────────────────────────────────────────────────
  await ds.query(`
    UPDATE title_hubs SET trending_score = (
      SELECT COALESCE(
        COUNT(DISTINCT hf.user_id) * 10 +
        COUNT(DISTINCT p.id) * 5 +
        COUNT(DISTINCT l.user_id) * 2 +
        COUNT(DISTINCT c.id), 0
      )
      FROM title_hubs th2
      LEFT JOIN hub_follows hf ON hf.hub_id = th2.id
      LEFT JOIN posts p ON p.hub_id = th2.id
      LEFT JOIN likes l ON l.post_id = p.id
      LEFT JOIN comments c ON c.post_id = p.id
      WHERE th2.id = title_hubs.id
    )
  `);
  console.log('✅ Calculated trending scores');

  await ds.destroy();
  console.log('');
  console.log('🎉 Seed complete!');
  console.log(`   Hubs     : ${hubs.length}`);
  console.log(`   Users    : ${users.length}`);
  console.log(`   Posts    : ${allPosts.length}`);
  console.log(`   Comments : ${allComments.length}`);
  console.log(`   Likes    : ${allLikes.length}`);
  console.log(`   Reposts  : ${allReposts.length}`);
  console.log('');
  console.log('All seed users share the password: SeedPass123!');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

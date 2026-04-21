/**
 * WatchCue seed script — v2
 *
 * Uses real TMDB data (enriched-movies.json) for posters, backdrops,
 * overviews, and cast. Every post gets either a trailer video or a
 * movie poster/backdrop. Comments reference the actual film.
 *
 * Run:  npm run db:seed
 */

import 'reflect-metadata';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { v4 as uuid } from 'uuid';
import { readFileSync } from 'fs';
import { join } from 'path';
import { User } from '../users/entities/user.entity';
import { Hub } from '../hubs/entities/hub.entity';
import { Post } from '../posts/entities/post.entity';
import { PostLike } from '../posts/entities/post-like.entity';
import { Comment } from '../comments/entities/comment.entity';
import { CommentLike } from '../comments/entities/comment-like.entity';
import { PostMedia } from '../posts/entities/post-media.entity';
import { PasswordResetToken } from '../auth/entities/password-reset-token.entity';

// ── Helpers ───────────────────────────────────────────────────────────────────

const rnd = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const rndInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;
const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const chunk = <T>(arr: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size),
  );

// ── Load enriched movie data ─────────────────────────────────────────────────

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

// Local trailers in public/trailers/ — must be real MP4 (ISO BMFF) for browsers.
// If yt-dlp gave MPEG-TS, run: npm run trailers:remux (needs ffmpeg).
// Prefer yt-dlp with MP4 output, e.g. --merge-output-format mp4 -S vcodec:h264,acodec:aac
// Keep in sync with files in public/trailers/ (run: npm run trailers:download)
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

// Map YouTube trailer IDs to movies for quick lookup
const trailerForMovie = new Map<number, string>();
for (const m of ENRICHED) {
  if (m.youtubeTrailerId && DOWNLOADED_TRAILER_IDS.includes(m.youtubeTrailerId)) {
    trailerForMovie.set(m.tmdbId, `/trailers/${m.youtubeTrailerId}.mp4`);
  }
}

// ── Movie-aware post templates ───────────────────────────────────────────────
// Each template function generates a title and content referencing the movie

function generatePostContent(movie: EnrichedMovie): { title: string; content: string; hasSpoiler: boolean } {
  const castNames = movie.cast.map(c => c.name);
  const lead = castNames[0] ?? 'the lead';
  const director = movie.genres.includes('Action') ? 'director' : 'filmmaker';

  const templates = [
    {
      title: `${movie.name} is a masterpiece — here's why`,
      content: `I just finished watching ${movie.name} for the third time and I'm even more convinced this is one of the best ${movie.genres[0]?.toLowerCase() ?? 'film'}s of our generation. ${movie.overview} The way every element comes together — the performances, the score, the cinematography — it's all working in perfect harmony. ${lead}'s performance alone is worth the price of admission.`,
      hasSpoiler: false,
    },
    {
      title: `The cinematography in ${movie.name} deserves more recognition`,
      content: `Can we talk about how beautiful ${movie.name} looks? Every single frame could be a painting. The ${director} understood that visual storytelling is just as important as the script. The colour palette shifts throughout the film in ways you don't consciously notice but that shape your entire emotional response. This is what happens when you give talented people the resources to do their best work.`,
      hasSpoiler: false,
    },
    {
      title: `${lead} gives a career-defining performance in ${movie.name}`,
      content: `I've followed ${lead}'s career for years but nothing prepared me for what they do in ${movie.name}. There's a scene about two-thirds in where they don't say a single word and it's the most powerful acting I've seen in years. The ${director} clearly trusted them completely and that trust is repaid a hundred times over. If you haven't seen this yet, go in blind.`,
      hasSpoiler: false,
    },
    {
      title: `I can't stop thinking about ${movie.name}`,
      content: `It's been a week since I watched ${movie.name} and I still can't get it out of my head. ${movie.overview} The themes here go much deeper than the surface story. On the surface it's a ${movie.genres[0]?.toLowerCase() ?? 'drama'} film, but underneath there's something much more profound about the human condition. The ending alone has kept me up at night.`,
      hasSpoiler: false,
    },
    {
      title: `${movie.name} — the ending changed everything (SPOILERS)`,
      content: `Going in blind was absolutely the right call for ${movie.name}. The final act recontextualises everything that came before it. Every small choice — a look, a gesture, a line that seemed throwaway — was deliberate. ${lead}'s expression in the final scene is devastatingly perfect. The ${director} had the whole architecture in their head from the first frame. I cannot believe I missed the foreshadowing on first watch.`,
      hasSpoiler: true,
    },
    {
      title: `The score in ${movie.name} is doing incredible work`,
      content: `I went straight to streaming the ${movie.name} soundtrack the moment I got home. There are themes running through this film that you barely notice consciously but they're shaping your emotional response the entire time. The composer created something that works both as a standalone piece and as a narrative device. Combined with ${lead}'s performance and the stunning visuals, this is a complete sensory experience.`,
      hasSpoiler: false,
    },
    {
      title: `Is ${movie.name} the best ${movie.genres[0]?.toLowerCase() ?? 'film'} of the decade?`,
      content: `I know that's a bold claim and I'm prepared to defend it. The technical achievements in ${movie.name} alone would justify the praise — rated ${movie.rating.toFixed(1)} on TMDB for good reason. But it's the emotional core that elevates it above its peers. ${movie.overview} I was genuinely moved in a way I haven't been by a film in a very long time. What do you all think?`,
      hasSpoiler: false,
    },
    {
      title: `Just watched ${movie.name} for the first time — wow`,
      content: `I know I'm late to the party but I finally watched ${movie.name} last night and I completely understand the hype. ${movie.overview} The performances are extraordinary, especially ${lead}. The pacing is perfect — not a single wasted scene. I immediately wanted to watch it again. What were your first impressions when you saw it?`,
      hasSpoiler: false,
    },
  ];

  return rnd(templates);
}

// ── Movie-specific comment templates ─────────────────────────────────────────

function generateComment(movie: EnrichedMovie): string {
  const lead = movie.cast[0]?.name ?? 'the lead';
  const second = movie.cast[1]?.name ?? 'the supporting cast';

  const templates = [
    `${lead}'s performance in ${movie.name} is genuinely the best I've seen this year. Completely transformative.`,
    `I've watched ${movie.name} three times now and each viewing reveals something new. The attention to detail is extraordinary.`,
    `The way ${movie.name} handles its ${movie.genres[0]?.toLowerCase()} elements is unlike anything else in the genre right now.`,
    `I was blown away by the cinematography in ${movie.name}. Every frame is composed with such intention.`,
    `${movie.name} is proof that ${movie.genres[0]?.toLowerCase()} films can be genuinely ambitious and intellectually rewarding.`,
    `${second} is doing extraordinary work in ${movie.name} too — everyone is at the top of their game.`,
    `The score in ${movie.name} enhances every scene. I've been listening to the soundtrack on repeat.`,
    `I didn't expect ${movie.name} to hit me this hard emotionally. I had to sit in silence for ten minutes after the credits.`,
    `The themes in ${movie.name} are more relevant now than ever. This is important filmmaking.`,
    `I've been recommending ${movie.name} to everyone I know. Nobody has been disappointed.`,
    `Second viewing of ${movie.name} is absolutely worth it. So much additional texture reveals itself.`,
    `${movie.name} rated ${movie.rating.toFixed(1)} on TMDB and honestly it deserves higher. A genuine masterpiece.`,
    `The editing in ${movie.name} is so precise. Every cut serves the story perfectly.`,
    `${lead} and ${second} have incredible chemistry in ${movie.name}. You can't fake that kind of connection on screen.`,
    `I wish more films had the ambition of ${movie.name}. This is what cinema is for.`,
  ];

  return rnd(templates);
}

// ── User data ─────────────────────────────────────────────────────────────────

const FIRST_NAMES = ['alex', 'sam', 'jordan', 'taylor', 'morgan', 'casey', 'riley', 'quinn', 'avery', 'blake', 'cameron', 'drew', 'evan', 'finley', 'grey', 'harper', 'indigo', 'jamie', 'kendall', 'lane', 'mika', 'noel', 'olive', 'parker', 'reed', 'sage', 'tatum', 'uma', 'vale', 'wren'];
const LAST_HANDLES = ['film', 'cinema', 'screen', 'watch', 'review', 'fan', 'buff', 'critic', 'nerd', 'lover', 'geek', 'head', 'fiend', 'addict', 'freak', 'junkie', 'hawk', 'hound', 'rat', 'club'];
const BIOS = [
  'Watching films since before I could read. Still haven\'t caught up.',
  'Professional overthinker. Amateur film critic. Occasional human.',
  'If I\'m not at the cinema I\'m thinking about the cinema.',
  'My letterboxd is more honest than my CV.',
  'Obsessed with how stories work and why some don\'t.',
  'Film school dropout who never stopped watching.',
  'Dark rooms and bright screens. That\'s where I live.',
  'The emotional damage has been worth it, mostly.',
  'Criterion collection owner, unironically.',
  'I rewatch more than I watch anything new. No regrets.',
  'Horror in October. Awards bait in November. Everything else always.',
  'Arguing about endings is my love language.',
  'Ask me about my favourite cinematographer. Go on. Ask.',
  'Real cinema is back and I\'m here for every frame of it.',
  'Life is too short for bad movies but too long without great ones.',
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Starting WatchCue seed v2…');
  console.log(`   ${ENRICHED.length} enriched movies loaded`);
  console.log(`   ${DOWNLOADED_TRAILER_IDS.length} local trailers available`);

  const ds = new DataSource({
    type: 'better-sqlite3',
    database: './data/watchcue.sqlite',
    synchronize: true,
    entities: [User, Hub, Post, PostMedia, PostLike, Comment, CommentLike, PasswordResetToken],
    logging: false,
  });

  await ds.initialize();
  console.log('✅ Connected to database');

  // ── Wipe seed tables ──────────────────────────────────────────────────────
  await ds.query('PRAGMA foreign_keys = OFF');
  for (const t of ['comment_likes', 'post_likes', 'comments', 'post_media', 'posts', 'hubs', 'users']) {
    await ds.query(`DELETE FROM ${t}`);
  }
  await ds.query('PRAGMA foreign_keys = ON');
  console.log('🗑️  Cleared existing data');

  // ── Step 1: Hubs (one per movie) ──────────────────────────────────────────
  const hubRepo = ds.getRepository(Hub);
  const hubs = await hubRepo.save(
    ENRICHED.map((m) =>
      hubRepo.create({
        id: uuid(),
        name: m.name,
        slug: slugify(m.name),
        description: m.overview,
        type: m.type,
        tmdbId: m.tmdbId,
        genres: m.genres,
        coverImageUrl: m.posterUrl,
        memberCount: rndInt(500, 15000),
        postCount: 0,
      }),
    ),
  );
  console.log(`✅ Created ${hubs.length} hubs`);

  // Build lookups
  const hubByTmdbId = new Map(hubs.map(h => [h.tmdbId, h]));
  const movieByTmdbId = new Map(ENRICHED.map(m => [m.tmdbId, m]));
  const hubsByGenre = new Map<string, Hub[]>();
  for (const hub of hubs) {
    for (const g of hub.genres) {
      if (!hubsByGenre.has(g)) hubsByGenre.set(g, []);
      hubsByGenre.get(g)!.push(hub);
    }
  }

  const ALL_GENRES = [...new Set(ENRICHED.flatMap(m => m.genres))];

  // ── Step 2: Users ─────────────────────────────────────────────────────────
  const seedPasswordHash = await bcrypt.hash('SeedPass123!', 8);
  const userRepo = ds.getRepository(User);
  const users: User[] = [];
  const usedUsernames = new Set<string>();

  for (let i = 0; i < 100; i++) {
    const first = rnd(FIRST_NAMES);
    const last = rnd(LAST_HANDLES);
    let username = `${first}_${last}`;
    if (usedUsernames.has(username)) username = `${username}${rndInt(10, 99)}`;
    usedUsernames.add(username);

    const genres = [...new Set([rnd(ALL_GENRES), rnd(ALL_GENRES), rnd(ALL_GENRES), rnd(ALL_GENRES)])].slice(0, rndInt(3, 5));
    const watchedTmdbIds = hubs
      .filter(h => h.type === 'movie')
      .sort(() => Math.random() - 0.5)
      .slice(0, rndInt(3, 8))
      .map(h => h.tmdbId!)
      .filter(Boolean);

    users.push(
      userRepo.create({
        id: uuid(),
        name: `${first.charAt(0).toUpperCase() + first.slice(1)} ${last.charAt(0).toUpperCase() + last.slice(1)}`,
        email: `${username}@watchcue.dev`,
        password: seedPasswordHash,
        username,
        bio: rnd(BIOS),
        profilePictureUrl: null,
        genres,
        watchedMovieIds: watchedTmdbIds as number[],
      }),
    );
  }
  await userRepo.save(users);
  console.log(`✅ Created ${users.length} users`);

  // ── Step 3: Posts (every post gets media) ─────────────────────────────────
  const postRepo = ds.getRepository(Post);
  const mediaRepo = ds.getRepository(PostMedia);
  const allPosts: Post[] = [];
  const allMedia: PostMedia[] = [];
  const POSTS_PER_USER = 20;

  for (const user of users) {
    const candidateHubs = new Set<Hub>();
    for (const g of user.genres) {
      for (const h of (hubsByGenre.get(g) ?? [])) candidateHubs.add(h);
    }
    const hubPool = candidateHubs.size >= 3 ? [...candidateHubs] : hubs;

    for (let p = 0; p < POSTS_PER_USER; p++) {
      const hub = rnd(hubPool);
      const movie = movieByTmdbId.get(hub.tmdbId!);
      if (!movie) continue;

      const postContent = generatePostContent(movie);
      const hoursAgo = rndInt(1, 72 * 7);
      const createdAt = new Date(Date.now() - hoursAgo * 3600000);
      const postId = uuid();

      const post = postRepo.create({
        id: postId,
        userId: user.id,
        hubId: hub.id,
        title: postContent.title,
        content: postContent.content,
        hasSpoiler: postContent.hasSpoiler,
        youtubeUrl: null,
        likeCount: 0,
        commentCount: 0,
        repostCount: rndInt(0, 40),
        viewCount: rndInt(50, 3000),
        isHot: false,
        isPinned: false,
        isDeleted: false,
        createdAt,
        updatedAt: createdAt,
      });
      allPosts.push(post);

      // Every post gets media: trailer video (if available), poster, or backdrop
      const trailerPath = trailerForMovie.get(movie.tmdbId);
      const roll = Math.random();

      if (trailerPath && roll < 0.45) {
        allMedia.push(mediaRepo.create({
          id: uuid(), postId, url: trailerPath,
          type: 'video', mimeType: 'video/mp4', displayOrder: 0,
        }));
      } else if (roll < 0.75) {
        allMedia.push(mediaRepo.create({
          id: uuid(), postId, url: movie.posterUrl,
          type: 'image', mimeType: 'image/jpeg', displayOrder: 0,
        }));
      } else {
        allMedia.push(mediaRepo.create({
          id: uuid(), postId, url: movie.backdropUrl,
          type: 'image', mimeType: 'image/jpeg', displayOrder: 0,
        }));
      }
    }
  }

  for (const batch of chunk(allPosts, 200)) await postRepo.save(batch);
  console.log(`✅ Created ${allPosts.length} posts`);
  for (const batch of chunk(allMedia, 500)) await mediaRepo.save(batch);
  console.log(`✅ Created ${allMedia.length} media items (every post has media)`);

  // ── Step 4: Comments (movie-specific) ─────────────────────────────────────
  const commentRepo = ds.getRepository(Comment);
  const allComments: Comment[] = [];
  const COMMENTS_PER_POST = 15;
  const TOP_LEVEL_PER_POST = 10;

  for (const post of allPosts) {
    const hub = hubByTmdbId.get(
      hubs.find(h => h.id === post.hubId)?.tmdbId ?? 0,
    );
    const movie = hub ? movieByTmdbId.get(hub.tmdbId!) : null;
    if (!movie) continue;

    const topLevelComments: Comment[] = [];
    const otherUsers = users.filter(u => u.id !== post.userId);

    for (let c = 0; c < TOP_LEVEL_PER_POST; c++) {
      const author = rnd(otherUsers);
      const offsetMs = rndInt(5, 60 * 60 * 48) * 1000;
      const createdAt = new Date(post.createdAt.getTime() + offsetMs);
      const comment = commentRepo.create({
        id: uuid(),
        postId: post.id,
        userId: author.id,
        parentCommentId: null,
        content: generateComment(movie),
        hasSpoiler: Math.random() < 0.05,
        likeCount: 0,
        replyCount: 0,
        depth: 0,
        isDeleted: false,
        createdAt,
        updatedAt: createdAt,
      });
      topLevelComments.push(comment);
      allComments.push(comment);
    }

    const repliesCount = COMMENTS_PER_POST - TOP_LEVEL_PER_POST;
    for (let r = 0; r < repliesCount; r++) {
      const parent = rnd(topLevelComments);
      const author = rnd(otherUsers);
      const offsetMs = rndInt(60000, 3600000 * 12);
      const createdAt = new Date(parent.createdAt.getTime() + offsetMs);
      allComments.push(commentRepo.create({
        id: uuid(),
        postId: post.id,
        userId: author.id,
        parentCommentId: parent.id,
        content: generateComment(movie),
        hasSpoiler: false,
        likeCount: 0,
        replyCount: 0,
        depth: 1,
        isDeleted: false,
        createdAt,
        updatedAt: createdAt,
      }));
    }
  }

  for (const batch of chunk(allComments, 500)) await commentRepo.save(batch);
  console.log(`✅ Created ${allComments.length} comments`);

  // ── Step 5: Likes ─────────────────────────────────────────────────────────
  const likeRepo = ds.getRepository(PostLike);
  const likeSet = new Set<string>();
  const allLikes: PostLike[] = [];

  for (const user of users) {
    const likeablePosts = allPosts
      .filter(p => {
        const hub = hubs.find(h => h.id === p.hubId)!;
        return hub.genres.some(g => user.genres.includes(g)) && p.userId !== user.id;
      })
      .sort(() => Math.random() - 0.5)
      .slice(0, rndInt(40, 80));

    for (const post of likeablePosts) {
      const key = `${user.id}:${post.id}`;
      if (likeSet.has(key)) continue;
      likeSet.add(key);
      allLikes.push(likeRepo.create({ userId: user.id, postId: post.id }));
    }
  }

  for (const batch of chunk(allLikes, 500)) await likeRepo.save(batch);
  console.log(`✅ Created ${allLikes.length} post likes`);

  // ── Step 6: Denormalized counts ───────────────────────────────────────────
  await ds.query(`UPDATE posts SET like_count = (SELECT COUNT(*) FROM post_likes WHERE post_id = posts.id)`);
  await ds.query(`UPDATE posts SET comment_count = (SELECT COUNT(*) FROM comments WHERE post_id = posts.id)`);
  await ds.query(`UPDATE comments SET reply_count = (SELECT COUNT(*) FROM comments c2 WHERE c2.parent_comment_id = comments.id)`);
  await ds.query(`UPDATE hubs SET post_count = (SELECT COUNT(*) FROM posts WHERE hub_id = hubs.id AND is_deleted = 0)`);
  await ds.query(`
    UPDATE posts SET is_hot = 1
    WHERE (like_count + comment_count * 2 + repost_count) >= (
      SELECT AVG(like_count + comment_count * 2 + repost_count) * 2.0 FROM posts
    )
  `);
  console.log('✅ Updated denormalized counts and hot flags');

  await ds.destroy();
  console.log('');
  console.log('🎉 Seed complete!');
  console.log(`   Hubs     : ${hubs.length}`);
  console.log(`   Users    : ${users.length}`);
  console.log(`   Posts    : ${allPosts.length}`);
  console.log(`   Media    : ${allMedia.length}`);
  console.log(`   Comments : ${allComments.length}`);
  console.log(`   Likes    : ${allLikes.length}`);
  console.log('');
  console.log('All seed users share the password: SeedPass123!');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

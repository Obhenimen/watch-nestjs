#!/usr/bin/env node
// One-off cleanup: only posts whose videoUrl maps to a real file on the server
// stay as media_type='video'. Every other "video" post is converted to an image
// post using the hub backdrop (fallback icon), or 'none' when neither exists.

import Database from 'better-sqlite3';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_PATH = join(ROOT, 'data', 'watchcue.sqlite');
const TRAILERS_DIR = join(ROOT, 'public', 'trailers');
const UPLOADS_POSTS_DIR = join(ROOT, 'uploads', 'posts');

function listLocalVideoUrls() {
  const urls = new Set();
  if (existsSync(TRAILERS_DIR)) {
    for (const f of readdirSync(TRAILERS_DIR)) {
      if (f.toLowerCase().endsWith('.mp4')) urls.add(`/trailers/${f}`);
    }
  }
  if (existsSync(UPLOADS_POSTS_DIR)) {
    const videoExt = /\.(mp4|mov|webm|avi)$/i;
    for (const f of readdirSync(UPLOADS_POSTS_DIR)) {
      if (videoExt.test(f)) urls.add(`/uploads/posts/${f}`);
    }
  }
  return urls;
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const localVideoUrls = listLocalVideoUrls();
console.log(`Found ${localVideoUrls.size} local video file(s) on disk:`);
for (const u of [...localVideoUrls].sort()) console.log(`  ${u}`);

const before = db
  .prepare(
    `SELECT
       SUM(CASE WHEN media_type='video' THEN 1 ELSE 0 END) AS video,
       SUM(CASE WHEN media_type='image' THEN 1 ELSE 0 END) AS image,
       SUM(CASE WHEN media_type='none'  THEN 1 ELSE 0 END) AS none
     FROM posts`,
  )
  .get();
console.log(`\nBefore: video=${before.video}, image=${before.image}, none=${before.none}`);

const keepList = [...localVideoUrls];
const placeholders = keepList.map(() => '?').join(',') || 'NULL';

const tx = db.transaction(() => {
  // 1) Convert video posts whose hub has a backdrop or icon to image posts.
  const toImage = db.prepare(
    `UPDATE posts
        SET media_type = 'image',
            image_url = COALESCE(
              (SELECT backdrop_url FROM title_hubs h WHERE h.id = posts.hub_id),
              (SELECT icon_url     FROM title_hubs h WHERE h.id = posts.hub_id)
            ),
            video_url = NULL,
            video_thumbnail_url = NULL,
            video_duration_secs = NULL,
            updated_at = datetime('now')
      WHERE media_type = 'video'
        AND (video_url IS NULL OR video_url NOT IN (${placeholders}))
        AND EXISTS (
          SELECT 1 FROM title_hubs h
           WHERE h.id = posts.hub_id
             AND (h.backdrop_url IS NOT NULL OR h.icon_url IS NOT NULL)
        )`,
  );
  const r1 = toImage.run(...keepList);
  console.log(`Converted to image: ${r1.changes}`);

  // 2) Anything left as 'video' without a real local file (hub has no images) → 'none'.
  const toNone = db.prepare(
    `UPDATE posts
        SET media_type = 'none',
            image_url = NULL,
            video_url = NULL,
            video_thumbnail_url = NULL,
            video_duration_secs = NULL,
            updated_at = datetime('now')
      WHERE media_type = 'video'
        AND (video_url IS NULL OR video_url NOT IN (${placeholders}))`,
  );
  const r2 = toNone.run(...keepList);
  console.log(`Set to none (no hub image available): ${r2.changes}`);
});

tx();

const after = db
  .prepare(
    `SELECT
       SUM(CASE WHEN media_type='video' THEN 1 ELSE 0 END) AS video,
       SUM(CASE WHEN media_type='image' THEN 1 ELSE 0 END) AS image,
       SUM(CASE WHEN media_type='none'  THEN 1 ELSE 0 END) AS none
     FROM posts`,
  )
  .get();
console.log(`\nAfter:  video=${after.video}, image=${after.image}, none=${after.none}`);

const orphaned = db
  .prepare(
    `SELECT COUNT(*) AS c FROM posts
      WHERE media_type='video'
        AND (video_url IS NULL OR video_url NOT IN (${placeholders}))`,
  )
  .get(...keepList);
console.log(`Orphan video posts remaining (should be 0): ${orphaned.c}`);

db.close();

/**
 * fetch-trailers.mjs — populate title_hubs.trailer_key with YouTube trailer IDs from TMDB.
 *
 * Run:  npm run db:trailers
 *
 * Env:
 *   TMPDB_KEY       — required
 *   DB_PATH         — default ./data/watchcue.sqlite
 *   LIMIT           — max hubs to process, default 3000 (ordered by trending_score DESC)
 *   BACKFILL_POSTS  — "1" to set video_url on random posts using their hub's trailer
 */

import Database from 'better-sqlite3';

const API_KEY  = process.env.TMPDB_KEY;
const DB_PATH  = process.env.DB_PATH ?? './data/watchcue.sqlite';
const LIMIT    = parseInt(process.env.LIMIT ?? '3000');
const BACKFILL = process.env.BACKFILL_POSTS === '1';
const BASE     = 'https://api.themoviedb.org/3';

if (!API_KEY) {
  console.error('Missing TMPDB_KEY in .env');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tmdb(path, params = {}, attempt = 0) {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set('api_key', API_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  let res;
  try {
    res = await fetch(url.toString());
  } catch (err) {
    if (attempt < 3) { await sleep(1000 * (attempt + 1)); return tmdb(path, params, attempt + 1); }
    throw err;
  }

  if (res.status === 429) {
    const wait = parseInt(res.headers.get('retry-after') ?? '2') * 1000;
    await sleep(wait + 500);
    return tmdb(path, params, attempt);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

// ── DB setup ───────────────────────────────────────────────────────────────

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Add columns if missing (SQLite has no IF NOT EXISTS for ADD COLUMN)
const cols = db.prepare(`PRAGMA table_info(title_hubs)`).all().map((c) => c.name);
if (!cols.includes('tmdb_id'))     db.exec(`ALTER TABLE title_hubs ADD COLUMN tmdb_id INTEGER`);
if (!cols.includes('trailer_key')) db.exec(`ALTER TABLE title_hubs ADD COLUMN trailer_key TEXT`);

// When WITH_POSTS=1, only process hubs that actually have posts — those are
// the ones whose content you'll see first in the feed, so they matter most.
const selectTargets = process.env.WITH_POSTS === '1'
  ? db.prepare(`
      SELECT h.id, h.name, h.year, h.type
      FROM title_hubs h
      WHERE h.trailer_key IS NULL
        AND h.id IN (SELECT DISTINCT hub_id FROM posts)
      ORDER BY h.trending_score DESC, h.followers_count DESC
      LIMIT ?
    `)
  : db.prepare(`
      SELECT id, name, year, type
      FROM title_hubs
      WHERE trailer_key IS NULL
      ORDER BY trending_score DESC, followers_count DESC
      LIMIT ?
    `);

const updateHub = db.prepare(`UPDATE title_hubs SET tmdb_id = ?, trailer_key = ? WHERE id = ?`);

// ── main ───────────────────────────────────────────────────────────────────

function pickBestVideo(results) {
  if (!results?.length) return null;
  // Priority: official Trailer on YouTube > Trailer > Teaser > any YouTube video
  const youtube = results.filter((v) => v.site === 'YouTube' && v.key);
  if (!youtube.length) return null;
  return (
    youtube.find((v) => v.type === 'Trailer' && v.official) ??
    youtube.find((v) => v.type === 'Trailer') ??
    youtube.find((v) => v.type === 'Teaser') ??
    youtube[0]
  ).key;
}

async function processHub(hub) {
  // 1. Search TMDB for the hub
  const searchPath = hub.type === 'movie' ? '/search/movie' : '/search/tv';
  const params = hub.type === 'movie'
    ? { query: hub.name, year: hub.year ?? '' }
    : { query: hub.name, first_air_date_year: hub.year ?? '' };

  const search = await tmdb(searchPath, params);
  const match = search?.results?.[0];
  if (!match) return { tmdbId: null, trailerKey: null };

  // 2. Fetch videos for the TMDB ID
  const videoPath = hub.type === 'movie'
    ? `/movie/${match.id}/videos`
    : `/tv/${match.id}/videos`;
  const videos = await tmdb(videoPath);
  const key = pickBestVideo(videos?.results);

  return { tmdbId: match.id, trailerKey: key };
}

async function main() {
  const targets = selectTargets.all(LIMIT);
  console.log(`\n  ${targets.length} hubs need trailers (top ${LIMIT} by trending)`);
  console.log('  Estimated API calls:', targets.length * 2);
  console.log('  Estimated time:', Math.ceil(targets.length * 2 * 25 / 60000), 'min\n');

  let found = 0;
  let missing = 0;
  let errors = 0;
  let done = 0;

  for (const hub of targets) {
    try {
      const { tmdbId, trailerKey } = await processHub(hub);
      updateHub.run(tmdbId, trailerKey, hub.id);
      if (trailerKey) found++;
      else missing++;
    } catch (err) {
      errors++;
      if (errors < 5) console.warn(`  ! ${hub.name}: ${err.message}`);
    }
    done++;
    if (done % 50 === 0) {
      process.stdout.write(`\r  progress ${done}/${targets.length} — trailers: ${found}, none: ${missing}, errors: ${errors}  `);
    }
    await sleep(25);
  }
  console.log(`\r  done ${done}/${targets.length} — trailers: ${found}, none: ${missing}, errors: ${errors}                    `);

  // ── optional: backfill video_url on posts ────────────────────────────────
  if (BACKFILL) {
    console.log('\n  Backfilling posts with hub trailers...');
    const updated = db.prepare(`
      UPDATE posts
      SET media_type = 'video',
          video_url  = 'https://www.youtube.com/watch?v=' || (
            SELECT trailer_key FROM title_hubs WHERE title_hubs.id = posts.hub_id
          ),
          image_url = NULL
      WHERE media_type = 'none'
        AND (hub_id) IN (SELECT id FROM title_hubs WHERE trailer_key IS NOT NULL)
    `).run();
    console.log(`  ✓ ${updated.changes} posts updated to use hub trailer`);
  }

  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM title_hubs WHERE trailer_key IS NOT NULL`).get();
  console.log(`\n  title_hubs with trailer_key: ${n}`);
  db.close();
}

main().catch((err) => {
  console.error('Fatal:', err.stack || err.message);
  db.close();
  process.exit(1);
});

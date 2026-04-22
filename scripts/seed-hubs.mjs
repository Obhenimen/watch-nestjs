/**
 * seed-hubs.mjs — populate title_hubs with 10k+ real titles from TMDB.
 *
 * Run via npm script (loads .env automatically):
 *   npm run db:hubs
 *
 * Env vars:
 *   TMPDB_KEY       — required (TMDB v3 API key, already in .env)
 *   DB_PATH         — default ./data/watchcue.sqlite
 *   PAGES           — pages per endpoint, default 500 (TMDB max)
 *   FETCH_CREDITS   — "1" to also fetch director/creator (adds ~1 API call per title — very slow at 10k scale)
 *
 * Uses 8 endpoints to guarantee 10k+ unique titles after in-memory dedup.
 */

import Database from 'better-sqlite3';
import crypto from 'crypto';

const API_KEY       = process.env.TMPDB_KEY;
const DB_PATH       = process.env.DB_PATH ?? './data/watchcue.sqlite';
const PAGES         = parseInt(process.env.PAGES ?? '500');
const FETCH_CREDITS = process.env.FETCH_CREDITS === '1';
const BASE_URL      = 'https://api.themoviedb.org/3';
const IMG_BASE      = 'https://image.tmdb.org/t/p';

if (!API_KEY) {
  console.error('\n  Missing TMPDB_KEY in .env\n');
  process.exit(1);
}

// ── helpers ────────────────────────────────────────────────────────────────

const uuid = () => crypto.randomUUID();
const now  = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tmdb(path, params = {}, attempt = 0) {
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set('api_key', API_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  let res;
  try {
    res = await fetch(url.toString());
  } catch (err) {
    if (attempt < 3) {
      await sleep(1000 * (attempt + 1));
      return tmdb(path, params, attempt + 1);
    }
    throw err;
  }

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('retry-after') ?? '2') * 1000;
    await sleep(retryAfter + 500);
    return tmdb(path, params, attempt);
  }

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`TMDB ${path} → HTTP ${res.status}`);

  return res.json();
}

// ── database ───────────────────────────────────────────────────────────────

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

const insertHub = db.prepare(`
  INSERT INTO title_hubs (
    id, name, year, type, genres, director,
    icon_url, backdrop_url, description,
    followers_count, posts_count, trending_score, created_at
  ) VALUES (
    @id, @name, @year, @type, @genres, @director,
    @icon_url, @backdrop_url, @description,
    0, 0, 0, @created_at
  )
`);

const insertMany = db.transaction((rows) => {
  for (const row of rows) insertHub.run(row);
});

// Pre-load existing titles so we don't re-insert seed data
const existing = db.prepare(`SELECT type, name, year FROM title_hubs`).all();
const seenKey = new Set(existing.map((h) => `${h.type}:${h.name}:${h.year ?? ''}`));
console.log(`  Loaded ${existing.length} existing hubs for dedup`);

// ── genre map ─────────────────────────────────────────────────────────────

async function buildGenreMap() {
  const [movieRes, tvRes] = await Promise.all([
    tmdb('/genre/movie/list'),
    tmdb('/genre/tv/list'),
  ]);
  const map = {};
  for (const g of [...movieRes.genres, ...tvRes.genres]) map[g.id] = g.name;
  return map;
}

// ── fetch from an endpoint ─────────────────────────────────────────────────

async function fetchEndpoint(label, path, type, genreMap, maxPages) {
  // First page tells us total_pages
  const first = await tmdb(path, { page: 1 });
  if (!first) return { inserted: 0, dupes: 0 };

  const totalPages = Math.min(first.total_pages ?? 1, 500, maxPages);
  console.log(`  ${label}: ${totalPages} pages (total ${first.total_results ?? '?'} titles)`);

  let inserted = 0;
  let dupes = 0;
  let buffer = [];

  const handleList = (results) => {
    for (const item of results) {
      const name = (type === 'movie' ? item.title : item.name)?.trim();
      if (!name) continue;

      const dateField = type === 'movie' ? item.release_date : item.first_air_date;
      const year = dateField ? parseInt(dateField.substring(0, 4)) : null;

      const key = `${type}:${name}:${year ?? ''}`;
      if (seenKey.has(key)) { dupes++; continue; }
      seenKey.add(key);

      const genres = (item.genre_ids ?? [])
        .map((id) => genreMap[id])
        .filter(Boolean)
        .join(', ') || null;

      buffer.push({
        id:           uuid(),
        name,
        year,
        type,
        genres,
        director:     null,
        icon_url:     item.poster_path   ? `${IMG_BASE}/w500${item.poster_path}`    : null,
        backdrop_url: item.backdrop_path ? `${IMG_BASE}/w1280${item.backdrop_path}` : null,
        description:  item.overview?.trim() || null,
        created_at:   now(),
      });
    }
  };

  handleList(first.results ?? []);

  for (let page = 2; page <= totalPages; page++) {
    try {
      const data = await tmdb(path, { page });
      if (data?.results) handleList(data.results);
    } catch (err) {
      console.warn(`    page ${page} failed: ${err.message}`);
    }

    if (buffer.length >= 200) {
      insertMany(buffer);
      inserted += buffer.length;
      buffer = [];
      process.stdout.write(`\r  ${label}: page ${page}/${totalPages}, inserted ${inserted}, dupes ${dupes}    `);
    }

    await sleep(25); // ~40 req/s, within TMDB's 50/s limit
  }

  if (buffer.length) {
    insertMany(buffer);
    inserted += buffer.length;
  }

  console.log(`\r  ${label}: done — inserted ${inserted}, dupes ${dupes}                          `);
  return { inserted, dupes };
}

// ── optional credit enrichment ─────────────────────────────────────────────

async function enrichCredits() {
  const toEnrich = db.prepare(`SELECT id, name, type FROM title_hubs WHERE director IS NULL LIMIT 20000`).all();
  console.log(`  enriching ${toEnrich.length} titles with director/creator (this is slow)...`);

  const update = db.prepare(`UPDATE title_hubs SET director = ? WHERE id = ?`);
  let done = 0;
  for (const row of toEnrich) {
    try {
      // We need the TMDB id, but we didn't persist it. Skip for now — enrichment
      // would require storing tmdb_id first. Leaving this as a placeholder.
      break;
    } catch { /* ignore */ }
    done++;
    if (done % 100 === 0) process.stdout.write(`\r    ${done}/${toEnrich.length}`);
  }
  console.log(`\r    enriched ${done}                `);
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n┌─────────────────────────────────────────┐');
  console.log('│        Title Hubs Seed (TMDB)           │');
  console.log('└─────────────────────────────────────────┘');
  console.log(`  Database : ${DB_PATH}`);
  console.log(`  Max pages: ${PAGES} per endpoint\n`);

  console.log('Step 1  Building genre map...');
  const genreMap = await buildGenreMap();
  console.log(`  ✓ ${Object.keys(genreMap).length} genres loaded\n`);

  console.log('Step 2  Fetching movies (4 endpoints)...');
  const movieEndpoints = [
    ['movie/popular',     '/movie/popular'],
    ['movie/top_rated',   '/movie/top_rated'],
    ['movie/now_playing', '/movie/now_playing'],
    ['movie/upcoming',    '/movie/upcoming'],
  ];
  let totalMovies = 0;
  for (const [label, path] of movieEndpoints) {
    const { inserted } = await fetchEndpoint(label, path, 'movie', genreMap, PAGES);
    totalMovies += inserted;
  }
  console.log(`  ✓ ${totalMovies} unique movies inserted\n`);

  console.log('Step 3  Fetching TV shows (4 endpoints)...');
  const tvEndpoints = [
    ['tv/popular',       '/tv/popular'],
    ['tv/top_rated',     '/tv/top_rated'],
    ['tv/on_the_air',    '/tv/on_the_air'],
    ['tv/airing_today',  '/tv/airing_today'],
  ];
  let totalTv = 0;
  for (const [label, path] of tvEndpoints) {
    const { inserted } = await fetchEndpoint(label, path, 'series', genreMap, PAGES);
    totalTv += inserted;
  }
  console.log(`  ✓ ${totalTv} unique series inserted\n`);

  if (FETCH_CREDITS) {
    console.log('Step 4  Enriching credits...');
    await enrichCredits();
  }

  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM title_hubs`).get();
  console.log('───────────────────────────────────────────');
  console.log(`  title_hubs total: ${n} rows`);
  console.log('  Done.\n');

  db.close();
}

main().catch((err) => {
  console.error('\nFatal error:', err.stack || err.message);
  db.close();
  process.exit(1);
});

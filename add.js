/**
 * seed-hubs.js
 *
 * Populates the title_hubs table with real movies and TV shows from TMDB.
 *
 * Setup:
 *   1. Get a free API key at https://www.themoviedb.org/settings/api
 *   2. npm install better-sqlite3
 *   3. TMDB_API_KEY=your_key node seed-hubs.js
 *
 * Options (env vars):
 *   TMDB_API_KEY  — required
 *   DB_PATH       — path to your SQLite file (default: ./app.sqlite)
 *   PAGES         — how many pages to fetch per type (default: 5 = ~100 titles each)
 *
 * Each page returns 20 results. 5 pages = ~100 movies + ~100 TV shows = ~200 hubs total.
 * Set PAGES=10 for ~400 hubs, PAGES=20 for ~800 hubs.
 */

import Database from 'better-sqlite3';
import crypto   from 'crypto';

// ── Config ─────────────────────────────────────────────────────────────────────

const API_KEY  = process.env.TMDB_API_KEY;
const DB_PATH  = process.env.DB_PATH  ?? './app.sqlite';
const PAGES    = parseInt(process.env.PAGES ?? '5');
const BASE_URL = 'https://api.themoviedb.org/3';
const IMG_BASE = 'https://image.tmdb.org/t/p';

if (!API_KEY) {
  console.error('\n  Missing TMDB_API_KEY\n');
  console.error('  Get a free key at: https://www.themoviedb.org/settings/api');
  console.error('  Then run: TMDB_API_KEY=your_key node seed-hubs.js\n');
  process.exit(1);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const uuid  = ()  => crypto.randomUUID();
const now   = ()  => new Date().toISOString();
const sleep = ms  => new Promise(r => setTimeout(r, ms));

async function tmdb(path, params = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set('api_key', API_KEY);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString());

  // Handle TMDB rate limit (429) with a backoff retry
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('retry-after') ?? '2') * 1000;
    console.warn(`  Rate limited — waiting ${retryAfter}ms...`);
    await sleep(retryAfter + 500);
    return tmdb(path, params);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`TMDB ${path} → HTTP ${res.status}: ${body}`);
  }

  return res.json();
}

// ── Database ───────────────────────────────────────────────────────────────────

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

const insertHub = db.prepare(`
  INSERT OR IGNORE INTO title_hubs (
    id, name, year, type, genres, director,
    icon_url, backdrop_url, description, created_at
  ) VALUES (
    @id, @name, @year, @type, @genres, @director,
    @icon_url, @backdrop_url, @description, @created_at
  )
`);

// ── Genre map ──────────────────────────────────────────────────────────────────

async function buildGenreMap() {
  const [movieRes, tvRes] = await Promise.all([
    tmdb('/genre/movie/list'),
    tmdb('/genre/tv/list'),
  ]);

  const map = {};
  for (const g of [...movieRes.genres, ...tvRes.genres]) {
    map[g.id] = g.name;
  }
  return map;
}

// ── Movie processing ───────────────────────────────────────────────────────────

async function seedMovies(genreMap) {
  let inserted = 0;
  let skipped  = 0;

  for (let page = 1; page <= PAGES; page++) {
    process.stdout.write(`  Movies page ${page}/${PAGES}: `);
    const { results } = await tmdb('/movie/popular', { page });

    for (const movie of results) {
      try {
        // Fetch credits to get the director
        const { crew } = await tmdb(`/movie/${movie.id}/credits`);
        const director = crew.find(c => c.job === 'Director')?.name ?? null;

        const genres = movie.genre_ids
          .map(id => genreMap[id])
          .filter(Boolean)
          .join(', ') || null;

        const changes = insertHub.run({
          id:           uuid(),
          name:         movie.title,
          year:         movie.release_date
                          ? parseInt(movie.release_date.substring(0, 4))
                          : null,
          type:         'movie',
          genres,
          director,
          icon_url:     movie.poster_path
                          ? `${IMG_BASE}/w500${movie.poster_path}`
                          : null,
          backdrop_url: movie.backdrop_path
                          ? `${IMG_BASE}/w1280${movie.backdrop_path}`
                          : null,
          description:  movie.overview?.trim() || null,
          created_at:   now(),
        });

        if (changes.changes > 0) inserted++;
        else skipped++;

        await sleep(60); // ~16 req/s, well under TMDB's 40/10s limit
      } catch (err) {
        skipped++;
        console.warn(`\n  ↳ Skipped "${movie.title}": ${err.message}`);
      }
    }

    console.log(`${results.length} fetched`);
    await sleep(400);
  }

  return { inserted, skipped };
}

// ── TV show processing ─────────────────────────────────────────────────────────

async function seedTVShows(genreMap) {
  let inserted = 0;
  let skipped  = 0;

  for (let page = 1; page <= PAGES; page++) {
    process.stdout.write(`  TV page ${page}/${PAGES}: `);
    const { results } = await tmdb('/tv/popular', { page });

    for (const show of results) {
      try {
        // Fetch full show details — created_by is only in the detail endpoint
        const details = await tmdb(`/tv/${show.id}`);
        const creator = details.created_by?.[0]?.name ?? null;

        const genres = show.genre_ids
          .map(id => genreMap[id])
          .filter(Boolean)
          .join(', ') || null;

        const changes = insertHub.run({
          id:           uuid(),
          name:         show.name,
          year:         show.first_air_date
                          ? parseInt(show.first_air_date.substring(0, 4))
                          : null,
          type:         'series',
          genres,
          director:     creator,         // stored in the director column as creator/showrunner
          icon_url:     show.poster_path
                          ? `${IMG_BASE}/w500${show.poster_path}`
                          : null,
          backdrop_url: show.backdrop_path
                          ? `${IMG_BASE}/w1280${show.backdrop_path}`
                          : null,
          description:  show.overview?.trim() || null,
          created_at:   now(),
        });

        if (changes.changes > 0) inserted++;
        else skipped++;

        await sleep(60);
      } catch (err) {
        skipped++;
        console.warn(`\n  ↳ Skipped "${show.name}": ${err.message}`);
      }
    }

    console.log(`${results.length} fetched`);
    await sleep(400);
  }

  return { inserted, skipped };
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n┌─────────────────────────────────────────┐');
  console.log('│         Title Hubs Seed Script          │');
  console.log('└─────────────────────────────────────────┘\n');
  console.log(`  Database : ${DB_PATH}`);
  console.log(`  Pages    : ${PAGES} per type (~${PAGES * 20} movies + ~${PAGES * 20} TV shows)\n`);

  console.log('Step 1/3  Building genre map...');
  const genreMap = await buildGenreMap();
  console.log(`  ✓ ${Object.keys(genreMap).length} genres loaded\n`);

  console.log('Step 2/3  Seeding movies...');
  const movies = await seedMovies(genreMap);
  console.log(`  ✓ ${movies.inserted} inserted, ${movies.skipped} skipped\n`);

  console.log('Step 3/3  Seeding TV shows...');
  const shows = await seedTVShows(genreMap);
  console.log(`  ✓ ${shows.inserted} inserted, ${shows.skipped} skipped\n`);

  const { n } = db.prepare('SELECT COUNT(*) AS n FROM title_hubs').get();
  console.log(`───────────────────────────────────────────`);
  console.log(`  title_hubs total: ${n} rows`);
  console.log(`  Done.\n`);

  db.close();
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  db.close();
  process.exit(1);
});
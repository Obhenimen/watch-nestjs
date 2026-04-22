/**
 * seed-list-items.mjs — populate Watchlist/Watched/Favorites for every user.
 *
 * Run:  npm run db:populate-lists
 *
 * Per user:
 *   watchlist  — 15–30 hubs, status = 'watching' (30%) | 'watch_next' (70%)
 *   watched    — 15–30 hubs, status = NULL
 *   favorites  —  5–15 hubs, status = NULL
 *
 * Draws from hubs that have posts (so items feel "active"), falling back to
 * top-trending hubs if a user needs more.
 */

import Database from 'better-sqlite3';

const DB_PATH = process.env.DB_PATH ?? './data/watchcue.sqlite';
const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rndInt = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const lists = db.prepare(`
  SELECT id, user_id, list_type FROM lists WHERE is_default = 1
`).all();
console.log(`  ${lists.length} default lists found`);

// Candidate hubs — prefer hubs that actually have posts, then top-trending
const activeHubs = db.prepare(`
  SELECT id FROM title_hubs WHERE posts_count > 0 ORDER BY trending_score DESC
`).all().map(r => r.id);
const topHubs = db.prepare(`
  SELECT id FROM title_hubs ORDER BY trending_score DESC LIMIT 5000
`).all().map(r => r.id);
const hubPool = activeHubs.length >= 100 ? activeHubs : topHubs;
console.log(`  hub pool: ${hubPool.length} hubs (preferring hubs with posts)`);

const insertItem = db.prepare(`
  INSERT OR IGNORE INTO list_items (list_id, hub_id, status, added_at)
  VALUES (?, ?, ?, ?)
`);
const tx = db.transaction((rows) => {
  for (const r of rows) insertItem.run(r.list_id, r.hub_id, r.status, r.added_at);
});

const now = Date.now();
const rows = [];

for (const list of lists) {
  const n = list.list_type === 'favorites' ? rndInt(5, 15) : rndInt(15, 30);
  const picks = [...hubPool].sort(() => Math.random() - 0.5).slice(0, n);

  for (const hubId of picks) {
    let status = null;
    if (list.list_type === 'watchlist') {
      status = Math.random() < 0.3 ? 'watching' : 'watch_next';
    }
    const addedAt = new Date(now - rndInt(1, 60) * 24 * 3600 * 1000).toISOString();
    rows.push({ list_id: list.id, hub_id: hubId, status, added_at: addedAt });
  }
}

console.log(`  inserting ${rows.length} list_items...`);
tx(rows);

// Recompute denormalized items_count
db.exec(`
  UPDATE lists SET items_count = (
    SELECT COUNT(*) FROM list_items WHERE list_items.list_id = lists.id
  )
`);

const summary = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM list_items)                                     AS total_items,
    (SELECT COUNT(*) FROM list_items li JOIN lists l ON l.id = li.list_id WHERE l.list_type = 'watchlist' AND li.status = 'watching')  AS watching,
    (SELECT COUNT(*) FROM list_items li JOIN lists l ON l.id = li.list_id WHERE l.list_type = 'watchlist' AND li.status = 'watch_next') AS watch_next,
    (SELECT COUNT(*) FROM list_items li JOIN lists l ON l.id = li.list_id WHERE l.list_type = 'watched')   AS watched,
    (SELECT COUNT(*) FROM list_items li JOIN lists l ON l.id = li.list_id WHERE l.list_type = 'favorites') AS favorites
`).get();

console.log('');
console.log('  ─────────────────────────────');
console.log(`  Total list_items: ${summary.total_items}`);
console.log(`  Watching:   ${summary.watching}`);
console.log(`  Watch next: ${summary.watch_next}`);
console.log(`  Watched:    ${summary.watched}`);
console.log(`  Favorites:  ${summary.favorites}`);

db.close();

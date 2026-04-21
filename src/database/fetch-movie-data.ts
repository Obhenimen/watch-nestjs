/**
 * Fetches real movie/TV data from FreeMovieData (TMDB proxy) and writes
 * a JSON file that the seed script uses for posters, backdrops, overviews,
 * and cast.
 *
 * Run:  npx ts-node src/database/fetch-movie-data.ts
 */

import { writeFileSync } from 'fs';
import { join } from 'path';

const API = 'https://www.freemoviedata.com/movies';

interface TmdbMovie {
  tmdb_id: number;
  title: string;
  overview: string;
  poster_url: string;
  backdrop_url: string;
  release_date: string;
  rating: number;
  genres: string[];
  cast: { name: string; character: string; headshot_url: string }[];
}

export interface EnrichedHub {
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

// All TMDB IDs from the seed (existing 30 + 20 new popular films).
// ytTrailerId = official YouTube trailer video id (for local files in public/trailers/).
const MOVIES: { tmdbId: number; type: 'movie' | 'tv'; ytTrailerId: string | null }[] = [
  // ── Modern blockbusters ──
  { tmdbId: 693134, type: 'movie', ytTrailerId: 'Way9Dexny3w' },
  { tmdbId: 157336, type: 'movie', ytTrailerId: 'zSWdZVtXT7E' },
  { tmdbId: 27205,  type: 'movie', ytTrailerId: 'YoHD9XEInc0' },
  { tmdbId: 545611, type: 'movie', ytTrailerId: 'wxN1T1uxQ2g' },
  { tmdbId: 569094, type: 'movie', ytTrailerId: 'cqGjhVJWtEg' },
  { tmdbId: 603692, type: 'movie', ytTrailerId: 'qEVUtrk8_B4' },
  { tmdbId: 361743, type: 'movie', ytTrailerId: 'giXco2jaZ_4' },
  { tmdbId: 155,    type: 'movie', ytTrailerId: 'EXeTwQWrcwY' },
  { tmdbId: 414906, type: 'movie', ytTrailerId: 'mqqft2x_Aa4' },
  { tmdbId: 872585, type: 'movie', ytTrailerId: 'uYPbbksJxIg' },
  { tmdbId: 466420, type: 'movie', ytTrailerId: 'EP34Yoxs3FQ' },
  { tmdbId: 792307, type: 'movie', ytTrailerId: 'RlbR5N6veqw' },
  { tmdbId: 346698, type: 'movie', ytTrailerId: 'pBk4NYhWNMM' },
  { tmdbId: 244786, type: 'movie', ytTrailerId: '7d_jQycdQGo' },
  { tmdbId: 419430, type: 'movie', ytTrailerId: 'DzfpyUB60YY' },
  { tmdbId: 493922, type: 'movie', ytTrailerId: 'dV8zKS2b7QQ' },
  { tmdbId: 530385, type: 'movie', ytTrailerId: '1Vnghdsjmd0' },
  { tmdbId: 496243, type: 'movie', ytTrailerId: '5xH0HfJHsaY' },
  { tmdbId: 76600,  type: 'movie', ytTrailerId: 'a8Gx8wiNbs8' },
  { tmdbId: 786892, type: 'movie', ytTrailerId: 'XJMuhwVlca4' },
  { tmdbId: 1022789, type: 'movie', ytTrailerId: 'yAZxxqQpSqI' },
  // ── Classics / all-time greats ──
  { tmdbId: 238,    type: 'movie', ytTrailerId: 'sY1S34973zA' },
  { tmdbId: 278,    type: 'movie', ytTrailerId: 'PLl99DlL6b4' },
  { tmdbId: 550,    type: 'movie', ytTrailerId: 'BdJKm16Co6M' },
  { tmdbId: 680,    type: 'movie', ytTrailerId: 'tGpTpVyI_OQ' },
  { tmdbId: 13,     type: 'movie', ytTrailerId: 'bLvqoHBptjg' },
  { tmdbId: 120,    type: 'movie', ytTrailerId: 'aStYWD25fAQ' },
  { tmdbId: 11,     type: 'movie', ytTrailerId: '1g3_cfGNbOs' },
  { tmdbId: 603,    type: 'movie', ytTrailerId: 'vKQi3bBA1y8' },
  { tmdbId: 769,    type: 'movie', ytTrailerId: '2ilzidi_J8Q' },
  { tmdbId: 389,    type: 'movie', ytTrailerId: 'TEn4MHRZt54' },
  { tmdbId: 429,    type: 'movie', ytTrailerId: 'WNhK00zpOOQ' },
  { tmdbId: 539,    type: 'movie', ytTrailerId: 'PeLPzXQKvP8' },
  { tmdbId: 578,    type: 'movie', ytTrailerId: 's82WBpfnCNM' },
  { tmdbId: 122,    type: 'movie', ytTrailerId: 'r5X-hFf6Bwo' },
  { tmdbId: 274,    type: 'movie', ytTrailerId: 'W6Mm8Sbe__o' },
  { tmdbId: 497,    type: 'movie', ytTrailerId: 'BlS73uqTu8A' },
  { tmdbId: 857,    type: 'movie', ytTrailerId: '9CiW_DgxCnY' },
  { tmdbId: 807,    type: 'movie', ytTrailerId: 'Spik5DZMeN4' },
  { tmdbId: 637,    type: 'movie', ytTrailerId: 'Cj9kRq37EoY' },
  { tmdbId: 1726,   type: 'movie', ytTrailerId: '8hYlB38asDY' },
  { tmdbId: 335984, type: 'movie', ytTrailerId: 'gCcx85zbxz4' },
  { tmdbId: 653346, type: 'movie', ytTrailerId: 'XtFI7SNtVpY' },
  { tmdbId: 1084736, type: 'movie', ytTrailerId: '8Q6y1waxlTY' },
];

async function fetchMovie(tmdbId: number): Promise<TmdbMovie | null> {
  try {
    const res = await fetch(`${API}/${tmdbId}`);
    if (!res.ok) return null;
    return (await res.json()) as TmdbMovie;
  } catch {
    return null;
  }
}

async function main() {
  const results: EnrichedHub[] = [];
  
  for (const movie of MOVIES) {
    const data = await fetchMovie(movie.tmdbId);
    if (!data) {
      console.error(`  ✗ Failed to fetch TMDB ${movie.tmdbId}`);
      continue;
    }
    
    results.push({
      tmdbId: movie.tmdbId,
      name: data.title,
      type: movie.type,
      overview: data.overview,
      posterUrl: data.poster_url,
      backdropUrl: data.backdrop_url,
      releaseDate: data.release_date,
      rating: data.rating,
      genres: data.genres,
      cast: (data.cast ?? []).slice(0, 5).map((c) => ({
        name: c.name,
        character: c.character,
        headshotUrl: c.headshot_url,
      })),
      youtubeTrailerId: movie.ytTrailerId,
    });
    
    console.log(`  ✓ ${data.title} (${movie.tmdbId})`);
    // Small delay to be polite
    await new Promise((r) => setTimeout(r, 200));
  }

  const outPath = join(__dirname, 'enriched-movies.json');
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\n✅ Wrote ${results.length} movies to ${outPath}`);
}

main().catch(console.error);

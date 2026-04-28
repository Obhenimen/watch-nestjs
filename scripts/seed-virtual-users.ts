/**
 * Seed three "virtual" users with hand-tuned profiles so the For You feed
 * surfaces a predictable kind of content for each.
 *
 *   user 1 — action / heroic / superhero
 *   user 2 — romance
 *   user 3 — real-life (history, biopic, documentary)
 *
 * After running, credentials are written to ./virtual-users.txt. Idempotent:
 * running again skips users that already exist.
 *
 * Run: npx ts-node scripts/seed-virtual-users.ts
 */
import 'reflect-metadata';
import * as bcrypt from 'bcryptjs';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { DataSource, ILike, In } from 'typeorm';
import { User } from '../src/users/entities/user.entity';
import { UserFollow } from '../src/users/entities/user-follow.entity';
import { Hub } from '../src/hubs/entities/hub.entity';
import { HubFollow } from '../src/hubs/entities/hub-follow.entity';
import { Post } from '../src/posts/entities/post.entity';
import { Like } from '../src/posts/entities/post-like.entity';
import { Repost } from '../src/posts/entities/repost.entity';
import { Comment } from '../src/comments/entities/comment.entity';
import { CommentLike } from '../src/comments/entities/comment-like.entity';
import { List } from '../src/lists/entities/list.entity';
import { ListItem } from '../src/lists/entities/list-item.entity';
import { Notification } from '../src/notifications/entities/notification.entity';
import { PasswordResetToken } from '../src/auth/entities/password-reset-token.entity';

interface VirtualUserSpec {
  email: string;
  username: string;
  displayName: string;
  password: string;
  description: string;
  // Hubs to follow + add to favorites + watchlist by exact name. These shape
  // the user's affinity profile, so the ranker recommends posts in these hubs.
  preferredHubNames: string[];
  // Genre keywords used as a fallback to find more taste-matching hubs (case
  // insensitive substring match against the comma-separated `genres` column).
  preferredGenres: string[];
}

const SPECS: VirtualUserSpec[] = [
  {
    email: 'marcus.weller92@gmail.com',
    username: 'action_fan',
    displayName: 'Action Fan',
    password: 'ActionFan!2026',
    description: 'Heroic / action / superhero (Batman, Superman, action)',
    preferredHubNames: [
      'The Dark Knight',
      'The Batman',
      'Iron Man',
      'Spider-Man: No Way Home',
      'Spider-Man: Across the Spider-Verse',
      'John Wick: Chapter 4',
      'The Matrix',
      'Top Gun: Maverick',
    ],
    preferredGenres: ['action', 'adventure'],
  },
  {
    email: 'emma.t.callahan@outlook.com',
    username: 'romance_reader',
    displayName: 'Romance Reader',
    password: 'RomanceReader!2026',
    description: 'Romance',
    preferredHubNames: [
      'Forrest Gump',
      'Cinema Paradiso',
      'Your Name.',
      'A Silent Voice: The Movie',
      'Reminders of Him',
      'Your Heart Will Be Broken',
      'Dilwale Dulhania Le Jayenge',
      'Gabriel’s Inferno',
    ],
    preferredGenres: ['romance'],
  },
  {
    email: 'jordan.hayes.films@gmail.com',
    username: 'real_life_lover',
    displayName: 'Real Life Lover',
    password: 'RealLife!2026',
    description: 'Based on real life (history / biopic / documentary)',
    preferredHubNames: [
      'Oppenheimer',
      'Killers of the Flower Moon',
      'Saving Private Ryan',
      "Schindler's List",
      'The Boy in the Striped Pyjamas',
      'Apocalypto',
      'Cosmos: A Personal Voyage',
      'Planet Earth II',
    ],
    preferredGenres: ['history', 'documentary', 'biography'],
  },
];

const SALT_ROUNDS = 12;

async function main() {
  const ds = new DataSource({
    type: 'better-sqlite3',
    database: process.env.DB_PATH ?? './data/watchcue.sqlite',
    entities: [
      User,
      UserFollow,
      Hub,
      HubFollow,
      Post,
      Like,
      Repost,
      Comment,
      CommentLike,
      List,
      ListItem,
      Notification,
      PasswordResetToken,
    ],
    synchronize: false,
    logging: false,
  });
  await ds.initialize();

  const userRepo = ds.getRepository(User);
  const listRepo = ds.getRepository(List);
  const itemRepo = ds.getRepository(ListItem);
  const hubRepo = ds.getRepository(Hub);
  const hubFollowRepo = ds.getRepository(HubFollow);

  const created: { spec: VirtualUserSpec; userId: string; hubMatches: number }[] = [];

  for (const spec of SPECS) {
    const existing = await userRepo.findOne({ where: { username: spec.username } });
    if (existing) {
      // Sync mutable fields so re-running the script picks up edits to SPECS
      // (e.g. updated email) without requiring a manual DB cleanup.
      const updates: Partial<User> = {};
      if (existing.email !== spec.email) updates.email = spec.email;
      if (existing.displayName !== spec.displayName) updates.displayName = spec.displayName;
      if (existing.bio !== spec.description) updates.bio = spec.description;
      if (Object.keys(updates).length) {
        await userRepo.update(existing.id, updates);
        console.log(`• ${spec.username} updated (${Object.keys(updates).join(', ')})`);
      } else {
        console.log(`• ${spec.username} already exists and is up to date — skipping`);
      }
      created.push({ spec, userId: existing.id, hubMatches: 0 });
      continue;
    }

    const passwordHash = await bcrypt.hash(spec.password, SALT_ROUNDS);
    const user = await userRepo.save(
      userRepo.create({
        email: spec.email,
        passwordHash,
        username: spec.username,
        displayName: spec.displayName,
        bio: spec.description,
      }),
    );

    // Default lists — same set the production signup flow creates.
    const [watchlist, watched, favorites] = await listRepo.save([
      listRepo.create({ userId: user.id, listType: 'watchlist', name: 'Watchlist', emoji: '\u{1F4CC}', isDefault: true }),
      listRepo.create({ userId: user.id, listType: 'watched', name: 'Watched', emoji: '✅', isDefault: true }),
      listRepo.create({ userId: user.id, listType: 'favorites', name: 'Favorites', emoji: '❤️', isDefault: true }),
    ]);

    // Find matching hubs: by exact name first, then top up with genre matches.
    const byName = spec.preferredHubNames.length
      ? await hubRepo.find({ where: { name: In(spec.preferredHubNames) } })
      : [];
    const byNameIds = new Set(byName.map((h) => h.id));

    const byGenre: Hub[] = [];
    for (const g of spec.preferredGenres) {
      const found = await hubRepo.find({
        where: { genres: ILike(`%${g}%`) },
        take: 12,
      });
      for (const h of found) {
        if (!byNameIds.has(h.id) && byGenre.every((x) => x.id !== h.id)) {
          byGenre.push(h);
        }
      }
    }

    const allMatches = [...byName, ...byGenre];

    // Strongest signal: favorites + follow.
    for (const hub of byName) {
      await itemRepo.save(itemRepo.create({ listId: favorites.id, hubId: hub.id }));
      await listRepo.increment({ id: favorites.id }, 'itemsCount', 1);
      const alreadyFollowing = await hubFollowRepo.findOne({ where: { userId: user.id, hubId: hub.id } });
      if (!alreadyFollowing) {
        await hubFollowRepo.save(hubFollowRepo.create({ userId: user.id, hubId: hub.id }));
        await hubRepo.increment({ id: hub.id }, 'followersCount', 1);
      }
    }

    // Genre-only matches go on the watchlist (intent to watch — second-strongest signal).
    for (const hub of byGenre.slice(0, 8)) {
      await itemRepo.save(itemRepo.create({ listId: watchlist.id, hubId: hub.id }));
      await listRepo.increment({ id: watchlist.id }, 'itemsCount', 1);
    }

    // Mark a couple as watched so the spoiler penalty doesn't apply universally
    // and the genre-affinity profile has data to chew on.
    for (const hub of byName.slice(0, 2)) {
      await itemRepo.save(itemRepo.create({ listId: watched.id, hubId: hub.id }));
      await listRepo.increment({ id: watched.id }, 'itemsCount', 1);
    }

    created.push({ spec, userId: user.id, hubMatches: allMatches.length });
    console.log(
      `✓ ${spec.username} (${spec.description}) created — id=${user.id}, ${allMatches.length} taste hubs attached`,
    );
  }

  await ds.destroy();

  // Write credentials file at repo root.
  const credPath = join(process.cwd(), 'virtual-users.txt');
  const lines: string[] = [
    'WatchCue — Virtual Users',
    '========================',
    '',
    'These accounts were created by scripts/seed-virtual-users.ts to demonstrate',
    'the For You feed personalising recommendations to a user’s taste profile.',
    '',
  ];
  for (const c of created) {
    lines.push(`User: ${c.spec.displayName} — ${c.spec.description}`);
    lines.push(`  Username: ${c.spec.username}`);
    lines.push(`  Email:    ${c.spec.email}`);
    lines.push(`  Password: ${c.spec.password}`);
    lines.push('');
  }
  writeFileSync(credPath, lines.join('\n'), 'utf8');
  console.log(`→ Credentials written to ${credPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

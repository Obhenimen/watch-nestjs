/**
 * Author 30+ posts for each virtual user, in hubs matching their taste.
 * Every post gets a title + image (the hub's backdrop).
 *
 * Idempotent on two axes:
 *   - if a user already has >= POSTS_PER_USER posts, no new posts are created
 *   - any of their existing posts that are missing a title or image are
 *     backfilled with a generated title and the hub's backdrop URL
 *
 * Run: npx ts-node scripts/seed-virtual-user-posts.ts
 */
import 'reflect-metadata';
import { DataSource, ILike, In, IsNull } from 'typeorm';
import { User } from '../src/users/entities/user.entity';
import { Hub } from '../src/hubs/entities/hub.entity';
import { Post } from '../src/posts/entities/post.entity';
import { Like } from '../src/posts/entities/post-like.entity';
import { Repost } from '../src/posts/entities/repost.entity';
import { Comment } from '../src/comments/entities/comment.entity';
import { CommentLike } from '../src/comments/entities/comment-like.entity';
import { UserFollow } from '../src/users/entities/user-follow.entity';
import { HubFollow } from '../src/hubs/entities/hub-follow.entity';
import { List } from '../src/lists/entities/list.entity';
import { ListItem } from '../src/lists/entities/list-item.entity';
import { Notification } from '../src/notifications/entities/notification.entity';
import { PasswordResetToken } from '../src/auth/entities/password-reset-token.entity';

const POSTS_PER_USER = 30;
const SPOILER_RATIO = 0.3;

interface Template {
  title: string;
  body: string;
}

const ACTION: Template[] = [
  { title: 'New gold standard', body: 'Just rewatched {hub} for the third time. The way they shoot action is unreal.' },
  { title: 'Hot take incoming', body: 'Hot take: {hub} has the best fight choreography of the decade.' },
  { title: 'The score deserves more credit', body: 'Nobody talks about how good the score in {hub} is.' },
  { title: 'Practical effects > CGI', body: '{hub} sets a new bar for practical effects. CGI could never match this.' },
  { title: 'Third-act masterclass', body: 'The third act of {hub} is genuinely some of the best filmmaking I’ve seen.' },
  { title: 'This is the bar', body: '{hub} is what action movies are supposed to be.' },
  { title: 'Friends night', body: 'Watching {hub} again with friends tonight. Couldn’t be more excited.' },
  { title: 'It hits different now', body: 'The protagonist arc in {hub} hits different on a second watch.' },
  { title: 'That stunt though', body: 'Genuinely cannot stop thinking about that one stunt in {hub}.' },
  { title: 'Underrated', body: '{hub} doesn’t get enough credit for how lean its storytelling is.' },
  { title: 'Best villain in years', body: 'Why is nobody talking about {hub}’s villain? Best in years.' },
  { title: 'Fight me', body: '{hub} > anything that’s come out in five years. Fight me.' },
  { title: 'Earning the emotion', body: 'The way {hub} earns its emotional beats is masterclass action filmmaking.' },
  { title: 'Less is more', body: '{hub} is proof that good action doesn’t need ten setpieces. One great one is enough.' },
  { title: 'Editing matters', body: 'Rewatching {hub} and the editing in the chase scene is so much better than I remembered.' },
];

const ROMANCE: Template[] = [
  { title: 'I cried again', body: 'Crying over {hub} for the fourth time. I don’t know what’s wrong with me.' },
  { title: 'Standards: ruined', body: '{hub} ruined my standards. Real life doesn’t actually go like that.' },
  { title: 'On a plane, no less', body: 'Watched {hub} on the plane and now I’m a wreck.' },
  { title: 'Frame for frame', body: 'Nobody’s talking enough about how beautifully {hub} is shot.' },
  { title: 'They have to be dating', body: 'The chemistry in {hub} is unreal. They have to be dating in real life.' },
  { title: 'A lesson in longing', body: '{hub} taught me what longing actually feels like.' },
  { title: 'A perfect movie', body: '{hub} is a perfect movie. Don’t argue with me.' },
  { title: 'That score', body: 'The score in {hub} should be a federal crime.' },
  { title: 'Required viewing', body: '{hub} is required viewing for anyone who’s ever been in love.' },
  { title: 'Five seconds', body: 'There’s a five-second moment in {hub} that wrecks me every time.' },
  { title: 'Living rent-free', body: 'Genuinely think about scenes from {hub} weekly.' },
  { title: 'It understood', body: '{hub} understood something other romance movies miss entirely.' },
  { title: 'Better than the "epics"', body: '{hub} > every "epic love story" being made today.' },
  { title: 'Three days later', body: 'Three days after watching {hub} and I’m still rearranging my life around it.' },
  { title: 'On silence', body: 'The way {hub} handles silence is so much better than the dialogue in most love stories.' },
];

const REAL_LIFE: Template[] = [
  { title: 'Reading the source', body: 'Started reading the source material for {hub} after watching. The book is just as devastating.' },
  { title: 'Historically airtight', body: 'The level of historical accuracy in {hub} is genuinely impressive.' },
  { title: 'School curriculum tier', body: '{hub} should be required viewing in history classes.' },
  { title: 'Still thinking', body: 'Three days after watching {hub} and still thinking about it.' },
  { title: 'Nonfiction stack', body: '{hub} got me reading nonfiction again.' },
  { title: 'Primary sources matter', body: 'Discussions of {hub} miss how careful the production was with primary sources.' },
  { title: 'Treats people with dignity', body: 'The way {hub} treats real people with dignity is rare in this genre.' },
  { title: 'Couldn’t sleep', body: 'Couldn’t sleep last night thinking about {hub}.' },
  { title: 'Cinema as classroom', body: '{hub} reminds you that good filmmaking can teach more than a textbook ever will.' },
  { title: '"Slow" is a compliment', body: 'People dismissing {hub} as "slow" are missing the point entirely.' },
  { title: 'They don’t make these anymore', body: '{hub} is the kind of movie they don’t make anymore.' },
  { title: 'Time travel', body: 'Watching {hub} feels like time travel.' },
  { title: 'The small details', body: '{hub} got the small details right in a way most period films don’t.' },
  { title: 'Asks the harder question', body: '{hub} doesn’t flinch from the harder questions, and that’s why it lands.' },
  { title: 'Stops feeling like a film', body: 'Halfway through {hub} you stop noticing it’s a film. Best compliment I can give it.' },
];

interface Profile {
  username: string;
  genres: string[];
  namedHubs: string[];
  templates: Template[];
}

const PROFILES: Profile[] = [
  {
    username: 'action_fan',
    genres: ['action', 'adventure'],
    namedHubs: [
      'The Dark Knight',
      'The Batman',
      'Iron Man',
      'Spider-Man: No Way Home',
      'Spider-Man: Across the Spider-Verse',
      'John Wick: Chapter 4',
      'The Matrix',
      'Top Gun: Maverick',
      'Furiosa: A Mad Max Saga',
      'Star Wars',
    ],
    templates: ACTION,
  },
  {
    username: 'romance_reader',
    genres: ['romance'],
    namedHubs: [
      'Forrest Gump',
      'Cinema Paradiso',
      'Your Name.',
      'A Silent Voice: The Movie',
      'Reminders of Him',
      'Your Heart Will Be Broken',
      'Dilwale Dulhania Le Jayenge',
      'Gabriel’s Inferno',
      'Just Married',
      'Last Chance Harvey',
    ],
    templates: ROMANCE,
  },
  {
    username: 'real_life_lover',
    genres: ['history', 'documentary', 'biography'],
    namedHubs: [
      'Oppenheimer',
      'Killers of the Flower Moon',
      'Saving Private Ryan',
      "Schindler's List",
      'The Boy in the Striped Pyjamas',
      'Apocalypto',
      'Cosmos: A Personal Voyage',
      'Planet Earth II',
      'Nuremberg',
      'The Voice of Hind Rajab',
    ],
    templates: REAL_LIFE,
  },
];

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const rndInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

function pickImage(hub: Hub): string | null {
  return hub.backdropUrl ?? hub.iconUrl ?? null;
}

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
  const hubRepo = ds.getRepository(Hub);
  const postRepo = ds.getRepository(Post);

  for (const profile of PROFILES) {
    const user = await userRepo.findOne({ where: { username: profile.username } });
    if (!user) {
      console.warn(`⚠ ${profile.username} not found — run seed-virtual-users.ts first. Skipping.`);
      continue;
    }

    // ── Backfill: any of this user's existing posts missing a title or image
    //    get a generated title and the hub's backdrop image.
    const stale = await postRepo.find({
      where: [
        { userId: user.id, title: IsNull() },
        { userId: user.id, mediaType: 'none' },
        { userId: user.id, imageUrl: IsNull() },
      ],
      relations: ['hub'],
    });
    if (stale.length) {
      let updated = 0;
      for (const p of stale) {
        if (!p.hub) continue;
        const tmpl = pick(profile.templates);
        if (!p.title) p.title = tmpl.title;
        const img = pickImage(p.hub);
        if (img && (!p.imageUrl || p.mediaType !== 'image')) {
          p.imageUrl = img;
          p.mediaType = 'image';
        }
        await postRepo.save(p);
        updated++;
      }
      console.log(`• ${profile.username}: backfilled title/image on ${updated} existing post(s)`);
    }

    // ── Top-up to POSTS_PER_USER if necessary.
    const existing = await postRepo.count({ where: { userId: user.id } });
    if (existing >= POSTS_PER_USER) {
      console.log(`• ${profile.username}: already has ${existing} posts — no new posts created`);
      continue;
    }
    const toCreate = POSTS_PER_USER - existing;

    const namedHubs = profile.namedHubs.length
      ? await hubRepo.find({ where: { name: In(profile.namedHubs) } })
      : [];
    const namedIds = new Set(namedHubs.map((h) => h.id));
    const genreHubs: Hub[] = [];
    for (const g of profile.genres) {
      const found = await hubRepo.find({ where: { genres: ILike(`%${g}%`) }, take: 25 });
      for (const h of found) {
        if (!namedIds.has(h.id) && genreHubs.every((x) => x.id !== h.id)) {
          genreHubs.push(h);
        }
      }
    }
    const hubPool = [...namedHubs, ...genreHubs];
    if (!hubPool.length) {
      console.warn(`⚠ ${profile.username}: no matching hubs found — skipping`);
      continue;
    }

    let createdSpoilers = 0;
    for (let i = 0; i < toCreate; i++) {
      const hub = pick(hubPool);
      const tmpl = pick(profile.templates);
      const body = tmpl.body.replace(/\{hub\}/g, hub.name);
      const hasSpoiler = Math.random() < SPOILER_RATIO;
      if (hasSpoiler) createdSpoilers++;
      const image = pickImage(hub);

      const post = postRepo.create({
        userId: user.id,
        hubId: hub.id,
        title: tmpl.title,
        body,
        hasSpoiler,
        mediaType: image ? 'image' : 'none',
        imageUrl: image,
        likesCount: rndInt(0, 25),
        repostsCount: rndInt(0, 4),
        commentsCount: rndInt(0, 6),
      });
      await postRepo.save(post);
      await hubRepo.increment({ id: hub.id }, 'postsCount', 1);
    }

    console.log(
      `✓ ${profile.username}: created ${toCreate} new posts (${createdSpoilers} spoilers) across ${hubPool.length} candidate hubs`,
    );
  }

  await ds.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

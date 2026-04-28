// One-off verification: pulls each virtual user's first page and prints the
// hub names + spoiler count + author so we can eyeball that personalisation
// is working and self-posts are excluded.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { FeedRankingService } from '../src/posts/feed-ranking.service';
import { DataSource } from 'typeorm';
import { User } from '../src/users/entities/user.entity';

const USERNAMES = ['action_fan', 'romance_reader', 'real_life_lover'];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const ranker = app.get(FeedRankingService);
  const ds = app.get(DataSource);
  const userRepo = ds.getRepository(User);

  for (const username of USERNAMES) {
    const u = await userRepo.findOneByOrFail({ username });
    const { posts, totalCandidates } = await ranker.rank(u.id, 10, 0);
    const spoilerCount = posts.filter((p) => p.hasSpoiler).length;
    const selfCount = posts.filter((p) => p.userId === u.id).length;
    console.log(`\n=== ${username} (${totalCandidates} candidates → top 10) ===`);
    console.log(`Spoilers in page: ${spoilerCount} | Self-authored: ${selfCount} (must be 0)`);
    posts.forEach((p, i) => {
      const isSelf = p.userId === u.id ? '!SELF!' : '      ';
      const title = (p.title ?? '(no title)').slice(0, 28).padEnd(28);
      const hub = (p.hub?.name ?? '?').slice(0, 30).padEnd(30);
      const img = p.imageUrl ? '✓img' : '   .';
      console.log(`  ${i + 1}. ${isSelf} ${title} | ${hub} ${img} spoiler=${p.hasSpoiler ? 'Y' : ' '}  L=${p.likesCount}`);
    });
  }

  await app.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

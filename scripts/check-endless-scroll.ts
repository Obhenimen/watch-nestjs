// Verify the For You feed produces enough candidates for endless scroll —
// sample several pages and confirm none come back empty.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { FeedRankingService } from '../src/posts/feed-ranking.service';
import { DataSource } from 'typeorm';
import { User } from '../src/users/entities/user.entity';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const ranker = app.get(FeedRankingService);
  const ds = app.get(DataSource);

  for (const username of ['action_fan', 'romance_reader', 'real_life_lover']) {
    const u = await ds.getRepository(User).findOneByOrFail({ username });
    process.stdout.write(`${username}: `);
    let totalSeen = 0;
    for (const offset of [0, 10, 20, 50, 100, 200]) {
      const { posts, totalCandidates } = await ranker.rank(u.id, 10, offset);
      totalSeen += posts.length;
      process.stdout.write(`offset=${offset}→${posts.length} `);
      if (offset === 0) process.stdout.write(`(pool=${totalCandidates}) `);
    }
    process.stdout.write('\n');
  }

  await app.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

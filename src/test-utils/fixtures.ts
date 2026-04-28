import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Hub } from '../hubs/entities/hub.entity';
import { Post } from '../posts/entities/post.entity';

let counter = 0;
const next = () => ++counter;

export async function makeUser(repo: Repository<User>, overrides: Partial<User> = {}): Promise<User> {
  const n = next();
  return repo.save(
    repo.create({
      email: overrides.email ?? `user${n}@test.local`,
      passwordHash: overrides.passwordHash ?? 'hash',
      username: overrides.username ?? `user${n}`,
      displayName: overrides.displayName ?? `User ${n}`,
      bio: overrides.bio ?? null,
      avatarUrl: overrides.avatarUrl ?? null,
      ...overrides,
    }),
  );
}

export async function makeHub(repo: Repository<Hub>, overrides: Partial<Hub> = {}): Promise<Hub> {
  const n = next();
  return repo.save(
    repo.create({
      name: overrides.name ?? `Hub ${n}`,
      year: overrides.year ?? 2024,
      type: overrides.type ?? 'movie',
      genres: overrides.genres ?? 'Drama',
      director: overrides.director ?? null,
      iconUrl: overrides.iconUrl ?? null,
      backdropUrl: overrides.backdropUrl ?? null,
      description: overrides.description ?? null,
      ...overrides,
    }),
  );
}

export async function makePost(
  repo: Repository<Post>,
  user: User,
  hub: Hub,
  overrides: Partial<Post> = {},
): Promise<Post> {
  return repo.save(
    repo.create({
      userId: user.id,
      hubId: hub.id,
      title: overrides.title ?? null,
      body: overrides.body ?? 'A post body',
      hasSpoiler: overrides.hasSpoiler ?? false,
      mediaType: overrides.mediaType ?? 'none',
      imageUrl: overrides.imageUrl ?? null,
      videoUrl: overrides.videoUrl ?? null,
      likesCount: overrides.likesCount ?? 0,
      repostsCount: overrides.repostsCount ?? 0,
      commentsCount: overrides.commentsCount ?? 0,
      ...overrides,
    }),
  );
}

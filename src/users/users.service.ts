import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { Post } from '../posts/entities/post.entity';
import { PostMedia } from '../posts/entities/post-media.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    @InjectRepository(Post)
    private readonly postRepo: Repository<Post>,
  ) {}

  create(data: Partial<User>): Promise<User> {
    const user = this.userRepo.create(data);
    return this.userRepo.save(user);
  }

  findByEmail(email: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { email } });
  }

  /** Returns user WITH the hashed password — only for auth use */
  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.userRepo
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.email = :email', { email })
      .getOne();
  }

  findByUsername(username: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { username } });
  }

  findById(id: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { id } });
  }

  async updatePassword(userId: string, hashedPassword: string): Promise<void> {
    await this.userRepo.update(userId, { password: hashedPassword });
  }

  async remove(id: string): Promise<void> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException(`User with id "${id}" not found`);
    await this.userRepo.remove(user);
  }

  async getProfile(userId: string) {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const postCount = await this.postRepo.count({
      where: { userId, isDeleted: false },
    });

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      bio: user.bio,
      profilePictureUrl: user.profilePictureUrl,
      genres: user.genres,
      watchedMovieIds: user.watchedMovieIds,
      postCount,
      followerCount: 0,
      followingCount: 0,
      createdAt: user.createdAt,
    };
  }

  async getUserPosts(userId: string, limit = 20, offset = 0) {
    const [posts, total] = await this.postRepo
      .createQueryBuilder('post')
      .leftJoinAndSelect('post.hub', 'hub')
      .leftJoinAndSelect('post.media', 'media')
      .where('post.userId = :userId', { userId })
      .andWhere('post.isDeleted = :deleted', { deleted: false })
      .orderBy('post.createdAt', 'DESC')
      .skip(offset)
      .take(limit)
      .getManyAndCount();

    const shaped = posts.map((p) => ({
      id: p.id,
      title: p.title,
      content: p.content,
      hasSpoiler: p.hasSpoiler,
      mediaUrls: (p.media ?? []).map((m) =>
        m.url.startsWith('http')
          ? m.url
          : `${process.env.API_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`}${m.url}`,
      ),
      likeCount: p.likeCount,
      commentCount: p.commentCount,
      createdAt: p.createdAt,
      hub: p.hub ? { id: p.hub.id, name: p.hub.name } : null,
    }));

    return { posts: shaped, total };
  }
}

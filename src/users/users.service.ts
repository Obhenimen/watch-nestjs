import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { UserFollow } from './entities/user-follow.entity';
import { List } from '../lists/entities/list.entity';
import { Post } from '../posts/entities/post.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { avatarUrl as buildAvatarUrl } from '../common/multer/multer.config';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    @InjectRepository(UserFollow)
    private readonly followRepo: Repository<UserFollow>,

    @InjectRepository(List)
    private readonly listRepo: Repository<List>,

    @InjectRepository(Post)
    private readonly postRepo: Repository<Post>,

    private readonly notificationsService: NotificationsService,
  ) {}

  async create(data: {
    email: string;
    passwordHash: string;
    username: string;
    displayName: string;
    bio?: string | null;
    avatarUrl?: string | null;
  }): Promise<User> {
    const user = await this.userRepo.save(
      this.userRepo.create({
        email: data.email,
        passwordHash: data.passwordHash,
        username: data.username,
        displayName: data.displayName,
        bio: data.bio ?? null,
        avatarUrl: data.avatarUrl ?? null,
      }),
    );

    const now = new Date();
    await this.listRepo.save([
      this.listRepo.create({ userId: user.id, listType: 'watchlist', name: 'Watchlist', emoji: '📌', isDefault: true }),
      this.listRepo.create({ userId: user.id, listType: 'watched',   name: 'Watched',   emoji: '✅', isDefault: true }),
      this.listRepo.create({ userId: user.id, listType: 'favorites', name: 'Favorites', emoji: '❤️', isDefault: true }),
    ]);

    return user;
  }

  findByEmail(email: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { email } });
  }

  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.userRepo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
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
    await this.userRepo.update(userId, { passwordHash: hashedPassword });
  }

  async updateProfile(
    userId: string,
    dto: UpdateUserDto,
    file?: Express.Multer.File,
  ) {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    // Username uniqueness — only check if it's actually changing.
    if (dto.username && dto.username !== user.username) {
      const clash = await this.userRepo.findOne({
        where: { username: dto.username, id: Not(userId) },
      });
      if (clash) {
        throw new ConflictException('That username is taken');
      }
      user.username = dto.username;
    }

    if (typeof dto.displayName === 'string') {
      user.displayName = dto.displayName;
    }

    if (dto.bio !== undefined) {
      // Empty string clears the bio; null also clears.
      user.bio = dto.bio ? dto.bio : null;
    }

    if (file) {
      user.avatarUrl = buildAvatarUrl(file.filename);
    }

    await this.userRepo.save(user);
    return this.getProfile(userId, userId);
  }

  async remove(id: string): Promise<void> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException(`User "${id}" not found`);
    await this.userRepo.remove(user);
  }

  async getProfile(userId: string, viewerId?: string) {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const postCount = await this.postRepo.count({ where: { userId } });

    let followedByMe = false;
    if (viewerId && viewerId !== userId) {
      const follow = await this.followRepo.findOne({
        where: { followerId: viewerId, followingId: userId },
      });
      followedByMe = !!follow;
    }

    return {
      id: user.id,
      email: userId === viewerId ? user.email : undefined,
      username: user.username,
      displayName: user.displayName,
      bio: user.bio,
      avatarUrl: user.avatarUrl,
      followersCount: user.followersCount,
      followingCount: user.followingCount,
      postCount,
      followedByMe,
      createdAt: user.createdAt,
    };
  }

  async getUserPosts(userId: string, limit = 20, cursor?: string) {
    const qb = this.postRepo
      .createQueryBuilder('post')
      .leftJoinAndSelect('post.hub', 'hub')
      .where('post.userId = :userId', { userId })
      .orderBy('post.createdAt', 'DESC')
      .take(limit + 1);

    if (cursor) qb.andWhere('post.createdAt < :cursor', { cursor });

    const rows = await qb.getMany();
    const hasNextPage = rows.length > limit;
    const posts = hasNextPage ? rows.slice(0, limit) : rows;

    return {
      posts: posts.map((p) => ({
        id: p.id,
        title: p.title,
        body: p.body,
        mediaType: p.mediaType,
        imageUrl: p.imageUrl,
        videoUrl: p.videoUrl,
        hasSpoiler: p.hasSpoiler,
        likesCount: p.likesCount,
        commentsCount: p.commentsCount,
        repostsCount: p.repostsCount,
        createdAt: p.createdAt,
        hub: p.hub ? { id: p.hub.id, name: p.hub.name, iconUrl: p.hub.iconUrl } : null,
      })),
      nextCursor: hasNextPage ? posts[posts.length - 1].createdAt.toISOString() : null,
      hasNextPage,
    };
  }

  async toggleFollow(targetId: string, followerId: string) {
    if (targetId === followerId) {
      throw new BadRequestException('You cannot follow yourself');
    }

    const target = await this.findById(targetId);
    if (!target) throw new NotFoundException('User not found');

    const existing = await this.followRepo.findOne({
      where: { followerId, followingId: targetId },
    });

    if (existing) {
      await this.followRepo.remove(existing);
      await this.userRepo.decrement({ id: targetId }, 'followersCount', 1);
      await this.userRepo.decrement({ id: followerId }, 'followingCount', 1);
      return { followed: false };
    } else {
      await this.followRepo.save(
        this.followRepo.create({ followerId, followingId: targetId }),
      );
      await this.userRepo.increment({ id: targetId }, 'followersCount', 1);
      await this.userRepo.increment({ id: followerId }, 'followingCount', 1);
      await this.notificationsService.create({
        recipientId: targetId,
        actorId: followerId,
        type: 'user_follow',
      });
      return { followed: true };
    }
  }
}

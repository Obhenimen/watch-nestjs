import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Post } from './entities/post.entity';
import { Like } from './entities/post-like.entity';
import { Repost } from './entities/repost.entity';
import { Hub } from '../hubs/entities/hub.entity';
import { HubFollow } from '../hubs/entities/hub-follow.entity';
import { User } from '../users/entities/user.entity';
import { Comment } from '../comments/entities/comment.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { CreatePostDto } from './dto/create-post.dto';
import { FeedQueryDto } from './dto/feed-query.dto';
import { FeedRankingService } from './feed-ranking.service';
import { isImage, isVideo, MAX_IMAGE_SIZE, mediaUrl } from '../common/multer/multer.config';

@Injectable()
export class PostsService {
  constructor(
    @InjectRepository(Post)
    private readonly postRepo: Repository<Post>,

    @InjectRepository(Like)
    private readonly likeRepo: Repository<Like>,

    @InjectRepository(Repost)
    private readonly repostRepo: Repository<Repost>,

    @InjectRepository(Hub)
    private readonly hubRepo: Repository<Hub>,

    @InjectRepository(HubFollow)
    private readonly hubFollowRepo: Repository<HubFollow>,

    @InjectRepository(Comment)
    private readonly commentRepo: Repository<Comment>,

    private readonly notificationsService: NotificationsService,
    private readonly feedRanking: FeedRankingService,
  ) {}

  // ── Create ──────────────────────────────────────────────────────────────────

  async create(author: User, dto: CreatePostDto, file?: Express.Multer.File) {
    const hub = await this.hubRepo.findOne({ where: { id: dto.hubId } });
    if (!hub) throw new NotFoundException(`Hub "${dto.hubId}" not found`);

    let mediaType: 'none' | 'image' | 'video' = 'none';
    let imageUrl: string | null = null;
    let videoUrl: string | null = null;

    if (file) {
      if (isImage(file.mimetype)) {
        if (file.size > MAX_IMAGE_SIZE) {
          throw new BadRequestException(`Image "${file.originalname}" exceeds the 10 MB limit.`);
        }
        mediaType = 'image';
        imageUrl = mediaUrl(file.filename);
      } else if (isVideo(file.mimetype)) {
        mediaType = 'video';
        videoUrl = mediaUrl(file.filename);
      }
    }

    const post = await this.postRepo.save(
      this.postRepo.create({
        userId: author.id,
        hubId: hub.id,
        title: dto.title ?? null,
        body: dto.body,
        hasSpoiler: dto.hasSpoiler ?? false,
        mediaType,
        imageUrl,
        videoUrl,
      }),
    );

    await this.hubRepo.increment({ id: hub.id }, 'postsCount', 1);
    return this.findById(post.id, author.id);
  }

  // ── For You feed (personalised, ranked) ─────────────────────────────────────
  //
  // Cursor here is an offset into the ranked candidate pool, encoded as a string
  // so the public DTO doesn't change. Candidates are regenerated each request,
  // so a refresh always reflects the latest engagement signals; the offset only
  // controls "load more" within a single browsing session. See FOR_YOU_FEED.md
  // for the full algorithm.
  async getFeed(viewer: User, query: FeedQueryDto) {
    const { limit = 20, cursor } = query;
    const offset = cursor ? Math.max(0, parseInt(cursor, 10) || 0) : 0;

    const { posts: rankedPosts } = await this.feedRanking.rank(viewer.id, limit + 1, offset);
    const hasNextPage = rankedPosts.length > limit;
    const posts = hasNextPage ? rankedPosts.slice(0, limit) : rankedPosts;

    if (!posts.length) return { posts: [], nextCursor: null, hasNextPage: false };

    const postIds = posts.map((p) => p.id);
    const [viewerLikes, viewerReposts, allTopComments] = await Promise.all([
      this.likeRepo.find({ where: { userId: viewer.id, postId: In(postIds) } }),
      this.repostRepo.find({ where: { userId: viewer.id, postId: In(postIds) } }),
      this.commentRepo
        .createQueryBuilder('c')
        .leftJoinAndSelect('c.author', 'author')
        .where('c.postId IN (:...postIds)', { postIds })
        .andWhere('c.parentId IS NULL')
        .orderBy('c.createdAt', 'DESC')
        .getMany(),
    ]);
    const likedSet = new Set(viewerLikes.map((l) => l.postId));
    const repostedSet = new Set(viewerReposts.map((r) => r.postId));

    // Group top-level comments by postId, keeping the 2 most recent per post.
    const topCommentsByPost = new Map<string, typeof allTopComments>();
    for (const c of allTopComments) {
      const list = topCommentsByPost.get(c.postId) ?? [];
      if (list.length < 2) {
        list.push(c);
        topCommentsByPost.set(c.postId, list);
      }
    }

    return {
      posts: posts.map((p) =>
        this.shape(
          p,
          likedSet.has(p.id),
          repostedSet.has(p.id),
          topCommentsByPost.get(p.id) ?? [],
        ),
      ),
      nextCursor: hasNextPage ? String(offset + limit) : null,
      hasNextPage,
    };
  }

  // ── Hub posts feed ───────────────────────────────────────────────────────────

  async getHubPosts(
    hubId: string,
    viewerId: string,
    sort: 'new' | 'top' | 'trending' = 'new',
    limit = 20,
    cursor?: string,
  ) {
    const hub = await this.hubRepo.findOne({ where: { id: hubId } });
    if (!hub) throw new NotFoundException('Hub not found');

    const qb = this.postRepo
      .createQueryBuilder('post')
      .leftJoinAndSelect('post.author', 'author')
      .leftJoinAndSelect('post.hub', 'hub')
      .where('post.hubId = :hubId', { hubId })
      .take(limit + 1);

    if (sort === 'top') {
      qb.orderBy('post.likesCount', 'DESC').addOrderBy('post.createdAt', 'DESC');
    } else if (sort === 'trending') {
      // Use snake_case column names — addSelect raw SQL is not rewritten by
      // TypeORM. No hard time window: the score already favours active posts,
      // and a 30-day cutoff hides every post when seed data is older.
      qb.addSelect(
        '(post.likes_count * 3 + post.reposts_count * 2 + post.comments_count)',
        'score',
      )
        .orderBy('score', 'DESC')
        .addOrderBy('post.createdAt', 'DESC');
    } else {
      qb.orderBy('post.createdAt', 'DESC');
    }

    if (cursor && sort === 'new') {
      qb.andWhere('post.createdAt < :cursor', { cursor });
    }

    const rows = await qb.getMany();
    const hasNextPage = rows.length > limit;
    const posts = hasNextPage ? rows.slice(0, limit) : rows;

    if (!posts.length) return { posts: [], nextCursor: null, hasNextPage: false };

    const postIds = posts.map((p) => p.id);
    const [viewerLikes, viewerReposts] = await Promise.all([
      this.likeRepo.find({ where: { userId: viewerId, postId: In(postIds) } }),
      this.repostRepo.find({ where: { userId: viewerId, postId: In(postIds) } }),
    ]);
    const likedSet = new Set(viewerLikes.map((l) => l.postId));
    const repostedSet = new Set(viewerReposts.map((r) => r.postId));

    return {
      posts: posts.map((p) => this.shape(p, likedSet.has(p.id), repostedSet.has(p.id))),
      nextCursor: hasNextPage ? posts[posts.length - 1].createdAt.toISOString() : null,
      hasNextPage,
    };
  }

  // ── Single post ─────────────────────────────────────────────────────────────

  async findById(postId: string, viewerId?: string) {
    const post = await this.postRepo
      .createQueryBuilder('post')
      .leftJoinAndSelect('post.author', 'author')
      .leftJoinAndSelect('post.hub', 'hub')
      .where('post.id = :id', { id: postId })
      .getOne();

    if (!post) throw new NotFoundException('Post not found');

    let liked = false;
    let reposted = false;
    if (viewerId) {
      const [like, repost] = await Promise.all([
        this.likeRepo.findOne({ where: { userId: viewerId, postId } }),
        this.repostRepo.findOne({ where: { userId: viewerId, postId } }),
      ]);
      liked = !!like;
      reposted = !!repost;
    }

    return this.shape(post, liked, reposted);
  }

  // ── Like / unlike ───────────────────────────────────────────────────────────

  async toggleLike(postId: string, userId: string) {
    const post = await this.postRepo.findOne({ where: { id: postId } });
    if (!post) throw new NotFoundException('Post not found');

    const existing = await this.likeRepo.findOne({ where: { userId, postId } });

    if (existing) {
      await this.likeRepo.remove(existing);
      await this.postRepo.decrement({ id: postId }, 'likesCount', 1);
    } else {
      await this.likeRepo.save(this.likeRepo.create({ userId, postId }));
      await this.postRepo.increment({ id: postId }, 'likesCount', 1);
      await this.notificationsService.create({
        recipientId: post.userId,
        actorId: userId,
        type: 'post_like',
        postId,
      });
    }

    const updated = await this.postRepo.findOneOrFail({ where: { id: postId } });
    return { liked: !existing, likesCount: updated.likesCount };
  }

  // ── Repost / unrepost ───────────────────────────────────────────────────────

  async toggleRepost(postId: string, userId: string) {
    const post = await this.postRepo.findOne({ where: { id: postId } });
    if (!post) throw new NotFoundException('Post not found');

    const existing = await this.repostRepo.findOne({ where: { userId, postId } });

    if (existing) {
      await this.repostRepo.remove(existing);
      await this.postRepo.decrement({ id: postId }, 'repostsCount', 1);
    } else {
      await this.repostRepo.save(this.repostRepo.create({ userId, postId }));
      await this.postRepo.increment({ id: postId }, 'repostsCount', 1);
      await this.notificationsService.create({
        recipientId: post.userId,
        actorId: userId,
        type: 'post_repost',
        postId,
      });
    }

    const updated = await this.postRepo.findOneOrFail({ where: { id: postId } });
    return { reposted: !existing, repostsCount: updated.repostsCount };
  }

  // ── Delete ──────────────────────────────────────────────────────────────────

  async remove(postId: string, requesterId: string): Promise<void> {
    const post = await this.postRepo.findOne({ where: { id: postId } });
    if (!post) throw new NotFoundException('Post not found');
    if (post.userId !== requesterId) {
      throw new ForbiddenException('You can only delete your own posts');
    }
    await this.postRepo.remove(post);
    await this.hubRepo.decrement({ id: post.hubId }, 'postsCount', 1);
  }

  // ── Shape helper ─────────────────────────────────────────────────────────────

  private shape(
    post: Post,
    likedByMe: boolean,
    repostedByMe: boolean,
    topComments: Comment[] = [],
  ) {
    return {
      id: post.id,
      userId: post.userId,
      hubId: post.hubId,
      title: post.title,
      body: post.body,
      mediaType: post.mediaType,
      imageUrl: post.imageUrl,
      videoUrl: post.videoUrl,
      videoThumbnailUrl: post.videoThumbnailUrl,
      videoDurationSecs: post.videoDurationSecs,
      hasSpoiler: post.hasSpoiler,
      likesCount: post.likesCount,
      repostsCount: post.repostsCount,
      commentsCount: post.commentsCount,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      likedByMe,
      repostedByMe,
      author: post.author
        ? {
            id: post.author.id,
            username: post.author.username,
            displayName: post.author.displayName,
            avatarUrl: post.author.avatarUrl ?? null,
          }
        : null,
      hub: post.hub
        ? {
            id: post.hub.id,
            name: post.hub.name,
            iconUrl: post.hub.iconUrl,
            type: post.hub.type,
            genres: post.hub.genres,
          }
        : null,
      topComments: topComments.map((c) => ({
        id: c.id,
        body: c.body,
        likesCount: c.likesCount,
        createdAt: c.createdAt,
        author: c.author
          ? {
              id: c.author.id,
              username: c.author.username,
              displayName: c.author.displayName,
              avatarUrl: c.author.avatarUrl ?? null,
            }
          : null,
      })),
    };
  }
}

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Post } from './entities/post.entity';
import { PostMedia } from './entities/post-media.entity';
import { PostLike } from './entities/post-like.entity';
import { Hub } from '../hubs/entities/hub.entity';
import { User } from '../users/entities/user.entity';
import { Comment } from '../comments/entities/comment.entity';
import { CreatePostDto } from './dto/create-post.dto';
import { FeedQueryDto } from './dto/feed-query.dto';
import {
  mediaUrl,
  isImage,
  isVideo,
  MAX_IMAGE_SIZE,
} from '../common/multer/multer.config';

/** Shape returned by the feed — matches the mobile FeedPost type exactly */
export interface FeedPost {
  id: string;
  userId: string;
  hubId: string;
  title: string;
  content: string;
  hasSpoiler: boolean;
  youtubeUrl: string | null;
  mediaUrls: string[];
  likeCount: number;
  commentCount: number;
  repostCount: number;
  viewCount: number;
  isHot: boolean;
  isPinned: boolean;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
  viewerHasLiked: boolean;
  author: { id: string; username: string; name: string; profilePictureUrl: string | null } | null;
  hub: Hub | null;
  topComments: FeedComment[];
}

export interface FeedComment {
  id: string;
  postId: string;
  userId: string;
  parentCommentId: string | null;
  content: string;
  hasSpoiler: boolean;
  likeCount: number;
  replyCount: number;
  depth: number;
  createdAt: Date;
  updatedAt: Date;
  author: { id: string; username: string; name: string; profilePictureUrl: string | null } | null;
}

@Injectable()
export class PostsService {
  constructor(
    @InjectRepository(Post)
    private readonly postRepo: Repository<Post>,

    @InjectRepository(PostMedia)
    private readonly mediaRepo: Repository<PostMedia>,

    @InjectRepository(PostLike)
    private readonly likeRepo: Repository<PostLike>,

    @InjectRepository(Hub)
    private readonly hubRepo: Repository<Hub>,

    @InjectRepository(Comment)
    private readonly commentRepo: Repository<Comment>,
  ) {}

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private shapeAuthor(user: User | null | undefined) {
    if (!user) return null;
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      profilePictureUrl: user.profilePictureUrl ?? null,
    };
  }

  private shapeComment(c: Comment): FeedComment {
    return {
      id: c.id,
      postId: c.postId,
      userId: c.userId,
      parentCommentId: c.parentCommentId,
      content: c.content,
      hasSpoiler: c.hasSpoiler,
      likeCount: c.likeCount,
      replyCount: c.replyCount,
      depth: c.depth,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      author: this.shapeAuthor(c.author),
    };
  }

  private shapePost(
    post: Post,
    viewerHasLiked: boolean,
    topComments: Comment[],
  ): FeedPost {
    return {
      id: post.id,
      userId: post.userId,
      hubId: post.hubId,
      title: post.title,
      content: post.content,
      hasSpoiler: post.hasSpoiler,
      youtubeUrl: post.youtubeUrl ?? null,
      mediaUrls: (post.media ?? []).map((m) =>
        m.url.startsWith('http') ? m.url : `${process.env.API_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`}${m.url}`,
      ),
      likeCount: post.likeCount,
      commentCount: post.commentCount,
      repostCount: post.repostCount,
      viewCount: post.viewCount,
      isHot: post.isHot,
      isPinned: post.isPinned,
      isDeleted: post.isDeleted,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      viewerHasLiked,
      author: this.shapeAuthor(post.author),
      hub: post.hub ?? null,
      topComments: topComments.map((c) => this.shapeComment(c)),
    };
  }

  // ── Create ──────────────────────────────────────────────────────────────────

  async create(
    author: User,
    dto: CreatePostDto,
    files: Express.Multer.File[],
  ): Promise<FeedPost> {
    const hub = await this.hubRepo.findOne({ where: { id: dto.hubId } });
    if (!hub) throw new NotFoundException(`Hub "${dto.hubId}" not found`);

    for (const file of files) {
      if (isImage(file.mimetype) && file.size > MAX_IMAGE_SIZE) {
        throw new BadRequestException(
          `Image "${file.originalname}" exceeds the 10 MB limit.`,
        );
      }
    }

    const post = this.postRepo.create({
      userId: author.id,
      hubId: hub.id,
      title: dto.title,
      content: dto.content,
      hasSpoiler: dto.hasSpoiler ?? false,
      youtubeUrl: dto.youtubeUrl ?? null,
    });

    const savedPost = await this.postRepo.save(post);

    if (files.length > 0) {
      const mediaEntities = files.map((file, index) =>
        this.mediaRepo.create({
          postId: savedPost.id,
          url: mediaUrl(file.filename),
          type: isVideo(file.mimetype) ? 'video' : 'image',
          mimeType: file.mimetype,
          sizeBytes: file.size,
          displayOrder: index,
        }),
      );
      await this.mediaRepo.save(mediaEntities);
    }

    await this.hubRepo.increment({ id: hub.id }, 'postCount', 1);

    return this.findById(savedPost.id, author.id);
  }

  // ── Feed ────────────────────────────────────────────────────────────────────

  async getFeed(
    viewer: User,
    query: FeedQueryDto,
  ): Promise<{ posts: FeedPost[]; total: number }> {
    const { limit = 20, offset = 0 } = query;

    const qb = this.postRepo
      .createQueryBuilder('post')
      .leftJoinAndSelect('post.author', 'author')
      .leftJoinAndSelect('post.hub', 'hub')
      .leftJoinAndSelect('post.media', 'media')
      .where('post.isDeleted = :deleted', { deleted: false });

    // Personalisation: match by genre or by movies the user has watched
    if (viewer.genres?.length || viewer.watchedMovieIds?.length) {
      const conditions: string[] = [];
      const params: Record<string, unknown> = {};

      if (viewer.genres?.length) {
        viewer.genres.forEach((genre, i) => {
          conditions.push(`hub.genres LIKE :genre${i}`);
          params[`genre${i}`] = `%${genre}%`;
        });
      }

      if (viewer.watchedMovieIds?.length) {
        conditions.push('hub.tmdbId IN (:...tmdbIds)');
        params['tmdbIds'] = viewer.watchedMovieIds;
      }

      // Always include trending posts regardless of hub match
      conditions.push('post.isHot = :hot');
      params['hot'] = true;

      qb.andWhere(`(${conditions.join(' OR ')})`, params);
    }

    // getManyAndCount() + arithmetic/combined ORDER BY breaks TypeORM 0.3
    // (createOrderByCombinedWithSelectExpression → undefined metadata / databaseName).
    // Count without ORDER BY, then load rows with simple column sorts only.
    const total = await qb.clone().getCount();

    qb.orderBy('post.isHot', 'DESC')
      .addOrderBy('post.likeCount', 'DESC')
      .addOrderBy('post.commentCount', 'DESC')
      .addOrderBy('post.createdAt', 'DESC');

    const posts = await qb.skip(offset).take(limit).getMany();

    if (posts.length === 0) return { posts: [], total };

    const postIds = posts.map((p) => p.id);

    // Batch: which posts the viewer has liked
    const viewerLikes = await this.likeRepo.find({
      where: { userId: viewer.id, postId: In(postIds) },
    });
    const likedSet = new Set(viewerLikes.map((l) => l.postId));

    // Batch: fetch top 3 comments per post (by likes then by date)
    const allTopComments = await this.commentRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.author', 'author')
      .where('c.postId IN (:...ids)', { ids: postIds })
      .andWhere('c.parentCommentId IS NULL')
      .andWhere('c.isDeleted = false')
      .orderBy('c.likeCount', 'DESC')
      .addOrderBy('c.createdAt', 'ASC')
      .getMany();

    // Group comments by postId, take top 3 each
    const commentsByPost = new Map<string, Comment[]>();
    for (const c of allTopComments) {
      const list = commentsByPost.get(c.postId) ?? [];
      if (list.length < 3) list.push(c);
      commentsByPost.set(c.postId, list);
    }

    const shaped = posts.map((p) =>
      this.shapePost(p, likedSet.has(p.id), commentsByPost.get(p.id) ?? []),
    );

    return { posts: shaped, total };
  }

  // ── Single post ─────────────────────────────────────────────────────────────

  async findById(postId: string, viewerId?: string): Promise<FeedPost> {
    const post = await this.postRepo
      .createQueryBuilder('post')
      .leftJoinAndSelect('post.author', 'author')
      .leftJoinAndSelect('post.hub', 'hub')
      .leftJoinAndSelect('post.media', 'media')
      .where('post.id = :id', { id: postId })
      .andWhere('post.isDeleted = :deleted', { deleted: false })
      .getOne();

    if (!post) throw new NotFoundException('Post not found');

    await this.postRepo.increment({ id: postId }, 'viewCount', 1);

    let liked = false;
    if (viewerId) {
      const like = await this.likeRepo.findOne({ where: { userId: viewerId, postId } });
      liked = !!like;
    }

    const topComments = await this.commentRepo.find({
      where: { postId, isDeleted: false },
      relations: ['author'],
      order: { likeCount: 'DESC', createdAt: 'ASC' },
      take: 3,
    });

    return this.shapePost(post, liked, topComments);
  }

  // ── Like / unlike ───────────────────────────────────────────────────────────

  async toggleLike(
    postId: string,
    userId: string,
  ): Promise<{ liked: boolean; likeCount: number }> {
    const post = await this.postRepo.findOne({ where: { id: postId, isDeleted: false } });
    if (!post) throw new NotFoundException('Post not found');

    const existing = await this.likeRepo.findOne({ where: { userId, postId } });

    if (existing) {
      await this.likeRepo.remove(existing);
      await this.postRepo.decrement({ id: postId }, 'likeCount', 1);
    } else {
      await this.likeRepo.save(this.likeRepo.create({ userId, postId }));
      await this.postRepo.increment({ id: postId }, 'likeCount', 1);
    }

    const updated = await this.postRepo.findOneOrFail({ where: { id: postId } });
    return { liked: !existing, likeCount: updated.likeCount };
  }

  // ── Delete ──────────────────────────────────────────────────────────────────

  async remove(postId: string, requesterId: string): Promise<void> {
    const post = await this.postRepo.findOne({ where: { id: postId } });
    if (!post) throw new NotFoundException('Post not found');
    if (post.userId !== requesterId) {
      throw new ForbiddenException('You can only delete your own posts');
    }
    await this.postRepo.update(postId, { isDeleted: true });
  }
}

import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Comment } from './entities/comment.entity';
import { CommentLike } from './entities/comment-like.entity';
import { Post } from '../posts/entities/post.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateCommentDto } from './dto/create-comment.dto';

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(Comment)
    private readonly commentRepo: Repository<Comment>,

    @InjectRepository(CommentLike)
    private readonly likeRepo: Repository<CommentLike>,

    @InjectRepository(Post)
    private readonly postRepo: Repository<Post>,

    private readonly notificationsService: NotificationsService,
  ) {}

  // ── Create ──────────────────────────────────────────────────────────────────

  async create(postId: string, author: User, dto: CreateCommentDto): Promise<Comment> {
    const post = await this.postRepo.findOne({ where: { id: postId } });
    if (!post) throw new NotFoundException('Post not found');

    let parentUserId: string | null = null;

    if (dto.parentId) {
      const parent = await this.commentRepo.findOne({
        where: { id: dto.parentId, postId },
      });
      if (!parent) throw new NotFoundException('Parent comment not found on this post');
      parentUserId = parent.userId;
    }

    const comment = await this.commentRepo.save(
      this.commentRepo.create({
        postId,
        userId: author.id,
        parentId: dto.parentId ?? null,
        body: dto.body,
      }),
    );

    await this.postRepo.increment({ id: postId }, 'commentsCount', 1);

    if (dto.parentId && parentUserId) {
      await this.notificationsService.create({
        recipientId: parentUserId,
        actorId: author.id,
        type: 'comment_reply',
        postId,
        commentId: comment.id,
      });
    } else {
      await this.notificationsService.create({
        recipientId: post.userId,
        actorId: author.id,
        type: 'post_comment',
        postId,
        commentId: comment.id,
      });
    }

    return this.findById(comment.id, author.id);
  }

  // ── List top-level comments ──────────────────────────────────────────────────

  async findByPost(postId: string, viewerId: string, limit = 20, cursor?: string) {
    const post = await this.postRepo.findOne({ where: { id: postId } });
    if (!post) throw new NotFoundException('Post not found');

    const qb = this.commentRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.author', 'author')
      .where('c.postId = :postId', { postId })
      .andWhere('c.parentId IS NULL')
      .orderBy('c.createdAt', 'ASC')
      .take(limit + 1);

    if (cursor) {
      qb.andWhere('c.createdAt > :cursor', { cursor });
    }

    const rows = await qb.getMany();
    const hasNextPage = rows.length > limit;
    const comments = hasNextPage ? rows.slice(0, limit) : rows;

    const ids = comments.map((c) => c.id);
    const viewerLikes = ids.length
      ? await this.likeRepo.find({ where: { userId: viewerId, commentId: In(ids) } })
      : [];
    const likedSet = new Set(viewerLikes.map((l) => l.commentId));

    return {
      comments: comments.map((c) => Object.assign(c, { likedByMe: likedSet.has(c.id) })),
      nextCursor: hasNextPage ? comments[comments.length - 1].createdAt.toISOString() : null,
      hasNextPage,
    };
  }

  // ── Replies ─────────────────────────────────────────────────────────────────

  async findReplies(commentId: string, viewerId: string, limit = 20, cursor?: string) {
    const parent = await this.commentRepo.findOne({ where: { id: commentId } });
    if (!parent) throw new NotFoundException('Comment not found');

    const qb = this.commentRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.author', 'author')
      .where('c.parentId = :commentId', { commentId })
      .orderBy('c.createdAt', 'ASC')
      .take(limit + 1);

    if (cursor) {
      qb.andWhere('c.createdAt > :cursor', { cursor });
    }

    const rows = await qb.getMany();
    const hasNextPage = rows.length > limit;
    const replies = hasNextPage ? rows.slice(0, limit) : rows;

    const ids = replies.map((c) => c.id);
    const viewerLikes = ids.length
      ? await this.likeRepo.find({ where: { userId: viewerId, commentId: In(ids) } })
      : [];
    const likedSet = new Set(viewerLikes.map((l) => l.commentId));

    return {
      comments: replies.map((c) => Object.assign(c, { likedByMe: likedSet.has(c.id) })),
      nextCursor: hasNextPage ? replies[replies.length - 1].createdAt.toISOString() : null,
      hasNextPage,
    };
  }

  // ── Single comment ────────────────────────────────────────────────────────

  async findById(commentId: string, viewerId?: string): Promise<Comment> {
    const comment = await this.commentRepo.findOne({
      where: { id: commentId },
      relations: ['author'],
    });
    if (!comment) throw new NotFoundException('Comment not found');

    if (viewerId) {
      const like = await this.likeRepo.findOne({ where: { userId: viewerId, commentId } });
      Object.assign(comment, { likedByMe: !!like });
    }

    return comment;
  }

  // ── Like / unlike ──────────────────────────────────────────────────────────

  async toggleLike(commentId: string, userId: string) {
    const comment = await this.commentRepo.findOne({ where: { id: commentId } });
    if (!comment) throw new NotFoundException('Comment not found');

    const existing = await this.likeRepo.findOne({ where: { userId, commentId } });

    if (existing) {
      await this.likeRepo.remove(existing);
      await this.commentRepo.decrement({ id: commentId }, 'likesCount', 1);
    } else {
      await this.likeRepo.save(this.likeRepo.create({ userId, commentId }));
      await this.commentRepo.increment({ id: commentId }, 'likesCount', 1);
      await this.notificationsService.create({
        recipientId: comment.userId,
        actorId: userId,
        type: 'comment_like',
        commentId,
      });
    }

    const updated = await this.commentRepo.findOneOrFail({ where: { id: commentId } });
    return { liked: !existing, likesCount: updated.likesCount };
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  async remove(commentId: string, requesterId: string): Promise<void> {
    const comment = await this.commentRepo.findOne({ where: { id: commentId } });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.userId !== requesterId) {
      throw new ForbiddenException('You can only delete your own comments');
    }
    await this.commentRepo.remove(comment);
    await this.postRepo.decrement({ id: comment.postId }, 'commentsCount', 1);
  }
}

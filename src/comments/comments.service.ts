import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Comment } from './entities/comment.entity';
import { CommentLike } from './entities/comment-like.entity';
import { Post } from '../posts/entities/post.entity';
import { User } from '../users/entities/user.entity';
import { CreateCommentDto } from './dto/create-comment.dto';

const MAX_DEPTH = 3;

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(Comment)
    private readonly commentRepo: Repository<Comment>,

    @InjectRepository(CommentLike)
    private readonly likeRepo: Repository<CommentLike>,

    @InjectRepository(Post)
    private readonly postRepo: Repository<Post>,
  ) {}

  // ── Create ──────────────────────────────────────────────────────────────────

  async create(
    postId: string,
    author: User,
    dto: CreateCommentDto,
  ): Promise<Comment> {
    const post = await this.postRepo.findOne({ where: { id: postId, isDeleted: false } });
    if (!post) throw new NotFoundException('Post not found');

    let depth = 0;

    if (dto.parentCommentId) {
      const parent = await this.commentRepo.findOne({
        where: { id: dto.parentCommentId, postId, isDeleted: false },
      });
      if (!parent) {
        throw new NotFoundException('Parent comment not found on this post');
      }
      depth = parent.depth + 1;
      if (depth > MAX_DEPTH) {
        throw new BadRequestException(
          `Maximum comment nesting depth of ${MAX_DEPTH} reached.`,
        );
      }
      // Increment parent's replyCount
      await this.commentRepo.increment({ id: parent.id }, 'replyCount', 1);
    }

    const comment = this.commentRepo.create({
      postId,
      userId: author.id,
      parentCommentId: dto.parentCommentId ?? null,
      content: dto.content,
      hasSpoiler: dto.hasSpoiler ?? false,
      depth,
    });

    const saved = await this.commentRepo.save(comment);

    // Increment post commentCount
    await this.postRepo.increment({ id: postId }, 'commentCount', 1);

    return this.findById(saved.id, author.id);
  }

  // ── List top-level comments for a post ──────────────────────────────────────

  async findByPost(
    postId: string,
    viewerId: string,
    limit = 20,
    offset = 0,
  ): Promise<{ comments: Comment[]; total: number }> {
    const post = await this.postRepo.findOne({ where: { id: postId, isDeleted: false } });
    if (!post) throw new NotFoundException('Post not found');

    const [comments, total] = await this.commentRepo.findAndCount({
      where: { postId, parentCommentId: IsNull() },
      relations: ['author'],
      order: { createdAt: 'ASC' },
      skip: offset,
      take: limit,
    });

    // Attach viewerHasLiked
    const ids = comments.map((c) => c.id);
    const viewerLikes = ids.length
      ? await this.likeRepo
          .createQueryBuilder('cl')
          .where('cl.user_id = :uid', { uid: viewerId })
          .andWhere('cl.comment_id IN (:...ids)', { ids })
          .getMany()
      : [];

    const likedSet = new Set(viewerLikes.map((l) => l.commentId));
    const enriched = comments.map((c) =>
      Object.assign(c, { viewerHasLiked: likedSet.has(c.id) }),
    );

    return { comments: enriched, total };
  }

  // ── Replies for a single comment ─────────────────────────────────────────────

  async findReplies(
    commentId: string,
    viewerId: string,
    limit = 20,
    offset = 0,
  ): Promise<{ comments: Comment[]; total: number }> {
    const parent = await this.commentRepo.findOne({ where: { id: commentId } });
    if (!parent) throw new NotFoundException('Comment not found');

    const [replies, total] = await this.commentRepo.findAndCount({
      where: { parentCommentId: commentId },
      relations: ['author'],
      order: { createdAt: 'ASC' },
      skip: offset,
      take: limit,
    });

    const ids = replies.map((c) => c.id);
    const viewerLikes = ids.length
      ? await this.likeRepo
          .createQueryBuilder('cl')
          .where('cl.user_id = :uid', { uid: viewerId })
          .andWhere('cl.comment_id IN (:...ids)', { ids })
          .getMany()
      : [];

    const likedSet = new Set(viewerLikes.map((l) => l.commentId));
    return {
      comments: replies.map((c) => Object.assign(c, { viewerHasLiked: likedSet.has(c.id) })),
      total,
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
      const like = await this.likeRepo.findOne({
        where: { userId: viewerId, commentId },
      });
      Object.assign(comment, { viewerHasLiked: !!like });
    }

    return comment;
  }

  // ── Like / unlike ──────────────────────────────────────────────────────────

  async toggleLike(
    commentId: string,
    userId: string,
  ): Promise<{ liked: boolean; likeCount: number }> {
    const comment = await this.commentRepo.findOne({ where: { id: commentId, isDeleted: false } });
    if (!comment) throw new NotFoundException('Comment not found');

    const existing = await this.likeRepo.findOne({ where: { userId, commentId } });

    if (existing) {
      await this.likeRepo.remove(existing);
      await this.commentRepo.decrement({ id: commentId }, 'likeCount', 1);
      const updated = await this.commentRepo.findOneOrFail({ where: { id: commentId } });
      return { liked: false, likeCount: updated.likeCount };
    } else {
      await this.likeRepo.save(this.likeRepo.create({ userId, commentId }));
      await this.commentRepo.increment({ id: commentId }, 'likeCount', 1);
      const updated = await this.commentRepo.findOneOrFail({ where: { id: commentId } });
      return { liked: true, likeCount: updated.likeCount };
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  async remove(commentId: string, requesterId: string): Promise<void> {
    const comment = await this.commentRepo.findOne({ where: { id: commentId } });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.userId !== requesterId) {
      throw new ForbiddenException('You can only delete your own comments');
    }
    await this.commentRepo.update(commentId, { isDeleted: true });
  }
}

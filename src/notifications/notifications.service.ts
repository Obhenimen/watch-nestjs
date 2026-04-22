import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification, NotificationType } from './entities/notification.entity';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notifRepo: Repository<Notification>,
  ) {}

  async create(data: {
    recipientId: string;
    actorId: string;
    type: NotificationType;
    postId?: string;
    commentId?: string;
    hubId?: string;
  }): Promise<void> {
    if (data.recipientId === data.actorId) return;
    await this.notifRepo.save(
      this.notifRepo.create({
        recipientId: data.recipientId,
        actorId: data.actorId,
        type: data.type,
        postId: data.postId ?? null,
        commentId: data.commentId ?? null,
        hubId: data.hubId ?? null,
      }),
    );
  }

  async getForUser(userId: string, limit = 20, cursor?: string) {
    const qb = this.notifRepo
      .createQueryBuilder('n')
      .leftJoinAndSelect('n.actor', 'actor')
      .leftJoinAndSelect('n.post', 'post')
      .leftJoinAndSelect('n.comment', 'comment')
      .leftJoinAndSelect('n.hub', 'hub')
      .where('n.recipientId = :userId', { userId })
      .orderBy('n.createdAt', 'DESC')
      .take(limit + 1);

    if (cursor) {
      qb.andWhere('n.createdAt < :cursor', { cursor });
    }

    const rows = await qb.getMany();
    const hasNextPage = rows.length > limit;
    const items = hasNextPage ? rows.slice(0, limit) : rows;

    return {
      notifications: items.map((n) => ({
        id: n.id,
        type: n.type,
        isRead: n.isRead,
        createdAt: n.createdAt,
        postId: n.postId,
        commentId: n.commentId,
        hubId: n.hubId,
        actor: n.actor
          ? {
              id: n.actor.id,
              username: n.actor.username,
              displayName: n.actor.displayName,
              avatarUrl: n.actor.avatarUrl ?? null,
            }
          : null,
        post: n.post
          ? {
              id: n.post.id,
              title: n.post.title,
              body: n.post.body,
            }
          : null,
        comment: n.comment
          ? {
              id: n.comment.id,
              body: n.comment.body,
            }
          : null,
        hub: n.hub
          ? {
              id: n.hub.id,
              name: n.hub.name,
              iconUrl: n.hub.iconUrl,
            }
          : null,
      })),
      nextCursor: hasNextPage
        ? items[items.length - 1].createdAt.toISOString()
        : null,
      hasNextPage,
    };
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.notifRepo.count({ where: { recipientId: userId, isRead: false } });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.notifRepo.update({ recipientId: userId, isRead: false }, { isRead: true });
  }
}

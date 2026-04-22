import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { Hub } from './entities/hub.entity';
import { HubFollow } from './entities/hub-follow.entity';

@Injectable()
export class HubsService {
  constructor(
    @InjectRepository(Hub)
    private readonly hubRepo: Repository<Hub>,

    @InjectRepository(HubFollow)
    private readonly hubFollowRepo: Repository<HubFollow>,
  ) {}

  async findAll(
    sort: 'trending' | 'new' | 'top' = 'trending',
    limit = 20,
    cursor?: string,
  ) {
    const qb = this.hubRepo.createQueryBuilder('h').take(limit + 1);

    if (sort === 'trending') {
      qb.orderBy('h.trendingScore', 'DESC').addOrderBy('h.createdAt', 'DESC');
    } else if (sort === 'top') {
      qb.orderBy('h.followersCount', 'DESC').addOrderBy('h.createdAt', 'DESC');
    } else {
      qb.orderBy('h.createdAt', 'DESC');
      if (cursor) qb.andWhere('h.createdAt < :cursor', { cursor });
    }

    const rows = await qb.getMany();
    const hasNextPage = rows.length > limit;
    const hubs = hasNextPage ? rows.slice(0, limit) : rows;

    return {
      hubs,
      nextCursor: hasNextPage && sort === 'new' ? hubs[hubs.length - 1].createdAt.toISOString() : null,
      hasNextPage,
    };
  }

  async search(query: string, limit = 20) {
    const hubs = await this.hubRepo.find({
      where: { name: ILike(`%${query}%`) },
      order: { followersCount: 'DESC' },
      take: limit,
    });
    return { hubs };
  }

  async findById(hubId: string, userId?: string) {
    const hub = await this.hubRepo.findOne({ where: { id: hubId } });
    if (!hub) throw new NotFoundException('Hub not found');

    let followedByMe = false;
    if (userId) {
      const follow = await this.hubFollowRepo.findOne({ where: { userId, hubId } });
      followedByMe = !!follow;
    }

    return { ...hub, followedByMe };
  }

  async toggleFollow(hubId: string, userId: string) {
    const hub = await this.hubRepo.findOne({ where: { id: hubId } });
    if (!hub) throw new NotFoundException('Hub not found');

    const existing = await this.hubFollowRepo.findOne({ where: { userId, hubId } });

    if (existing) {
      await this.hubFollowRepo.remove(existing);
      await this.hubRepo.decrement({ id: hubId }, 'followersCount', 1);
      return { followed: false, followersCount: hub.followersCount - 1 };
    } else {
      await this.hubFollowRepo.save(this.hubFollowRepo.create({ userId, hubId }));
      await this.hubRepo.increment({ id: hubId }, 'followersCount', 1);
      return { followed: true, followersCount: hub.followersCount + 1 };
    }
  }

  async getFollowedHubs(userId: string) {
    const follows = await this.hubFollowRepo.find({
      where: { userId },
      relations: ['hub'],
      order: { createdAt: 'DESC' },
    });
    return { hubs: follows.map((f) => f.hub) };
  }
}

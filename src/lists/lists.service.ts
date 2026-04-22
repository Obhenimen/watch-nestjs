import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { List } from './entities/list.entity';
import { ListItem } from './entities/list-item.entity';
import { Hub } from '../hubs/entities/hub.entity';
import { CreateListDto } from './dto/create-list.dto';
import { AddListItemDto } from './dto/add-list-item.dto';

@Injectable()
export class ListsService {
  constructor(
    @InjectRepository(List)
    private readonly listRepo: Repository<List>,

    @InjectRepository(ListItem)
    private readonly itemRepo: Repository<ListItem>,

    @InjectRepository(Hub)
    private readonly hubRepo: Repository<Hub>,
  ) {}

  async getUserLists(userId: string) {
    const [defaults, custom] = await Promise.all([
      this.listRepo
        .createQueryBuilder('l')
        .where('l.userId = :userId', { userId })
        .andWhere('l.isDefault = :d', { d: true })
        .orderBy(`CASE l.listType WHEN 'watchlist' THEN 1 WHEN 'watched' THEN 2 WHEN 'favorites' THEN 3 ELSE 4 END`, 'ASC')
        .getMany(),
      this.listRepo.find({
        where: { userId, listType: 'custom' },
        order: { createdAt: 'DESC' },
      }),
    ]);
    return { defaults, custom };
  }

  async createList(userId: string, dto: CreateListDto): Promise<List> {
    return this.listRepo.save(
      this.listRepo.create({
        userId,
        listType: 'custom',
        name: dto.name,
        emoji: dto.emoji ?? null,
        description: dto.description ?? null,
        isDefault: false,
        isPublic: dto.isPublic ?? false,
      }),
    );
  }

  async deleteList(listId: string, userId: string): Promise<void> {
    const list = await this.listRepo.findOne({ where: { id: listId } });
    if (!list) throw new NotFoundException('List not found');
    if (list.userId !== userId) throw new ForbiddenException('Not your list');
    if (list.isDefault) throw new BadRequestException('Default lists cannot be deleted');
    await this.listRepo.remove(list);
  }

  async addItem(listId: string, userId: string, dto: AddListItemDto) {
    const list = await this.listRepo.findOne({ where: { id: listId } });
    if (!list) throw new NotFoundException('List not found');
    if (list.userId !== userId) throw new ForbiddenException('Not your list');

    const hub = await this.hubRepo.findOne({ where: { id: dto.hubId } });
    if (!hub) throw new NotFoundException('Hub not found');

    const existing = await this.itemRepo.findOne({
      where: { listId, hubId: dto.hubId },
    });
    if (existing) throw new ConflictException('Hub already in this list');

    await this.itemRepo.save(
      this.itemRepo.create({
        listId,
        hubId: dto.hubId,
        status: dto.status ?? null,
      }),
    );
    await this.listRepo.increment({ id: listId }, 'itemsCount', 1);
    return { ok: true };
  }

  async removeItem(listId: string, hubId: string, userId: string): Promise<void> {
    const list = await this.listRepo.findOne({ where: { id: listId } });
    if (!list) throw new NotFoundException('List not found');
    if (list.userId !== userId) throw new ForbiddenException('Not your list');

    const item = await this.itemRepo.findOne({ where: { listId, hubId } });
    if (!item) throw new NotFoundException('Item not found in this list');

    await this.itemRepo.remove(item);
    await this.listRepo.decrement({ id: listId }, 'itemsCount', 1);
  }

  async getListItems(listId: string, userId: string, limit = 20, cursor?: string) {
    const list = await this.listRepo.findOne({ where: { id: listId } });
    if (!list) throw new NotFoundException('List not found');
    if (list.userId !== userId && !list.isPublic) {
      throw new ForbiddenException('This list is private');
    }

    const qb = this.itemRepo
      .createQueryBuilder('li')
      .leftJoinAndSelect('li.hub', 'hub')
      .where('li.listId = :listId', { listId })
      .orderBy('li.addedAt', 'DESC')
      .take(limit + 1);

    if (cursor) qb.andWhere('li.addedAt < :cursor', { cursor });

    const rows = await qb.getMany();
    const hasNextPage = rows.length > limit;
    const items = hasNextPage ? rows.slice(0, limit) : rows;

    return {
      items,
      nextCursor: hasNextPage ? items[items.length - 1].addedAt.toISOString() : null,
      hasNextPage,
    };
  }
}

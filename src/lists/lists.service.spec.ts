import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { ListsService } from './lists.service';
import { List } from './entities/list.entity';
import { ListItem } from './entities/list-item.entity';
import { Hub } from '../hubs/entities/hub.entity';
import { User } from '../users/entities/user.entity';
import { inMemoryDbConfig } from '../test-utils/test-db';
import { makeUser, makeHub } from '../test-utils/fixtures';

describe('ListsService', () => {
  let module: TestingModule;
  let lists: ListsService;
  let userRepo: Repository<User>;
  let hubRepo: Repository<Hub>;
  let listRepo: Repository<List>;
  let itemRepo: Repository<ListItem>;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(inMemoryDbConfig()),
        TypeOrmModule.forFeature([List, ListItem, Hub, User]),
      ],
      providers: [ListsService],
    }).compile();

    lists = module.get(ListsService);
    userRepo = module.get(getRepositoryToken(User));
    hubRepo = module.get(getRepositoryToken(Hub));
    listRepo = module.get(getRepositoryToken(List));
    itemRepo = module.get(getRepositoryToken(ListItem));
  });

  afterEach(async () => {
    await module.close();
  });

  async function defaultList(userId: string, type: 'watchlist' | 'watched' | 'favorites') {
    return listRepo.save(
      listRepo.create({
        userId,
        listType: type,
        name: type,
        isDefault: true,
      }),
    );
  }

  describe('addItem', () => {
    it('adds an item, increments itemsCount, and returns ok', async () => {
      const u = await makeUser(userRepo);
      const list = await defaultList(u.id, 'watchlist');
      const hub = await makeHub(hubRepo);

      await lists.addItem(list.id, u.id, { hubId: hub.id });

      const refreshed = await listRepo.findOneByOrFail({ id: list.id });
      expect(refreshed.itemsCount).toBe(1);
      const items = await itemRepo.find({ where: { listId: list.id } });
      expect(items).toHaveLength(1);
    });

    it('rejects adding the same hub twice (and does not double-increment)', async () => {
      const u = await makeUser(userRepo);
      const list = await defaultList(u.id, 'watchlist');
      const hub = await makeHub(hubRepo);

      await lists.addItem(list.id, u.id, { hubId: hub.id });
      await expect(
        lists.addItem(list.id, u.id, { hubId: hub.id }),
      ).rejects.toBeInstanceOf(ConflictException);

      const refreshed = await listRepo.findOneByOrFail({ id: list.id });
      expect(refreshed.itemsCount).toBe(1);
    });

    it('rejects another user trying to add to your list', async () => {
      const a = await makeUser(userRepo);
      const b = await makeUser(userRepo);
      const list = await defaultList(a.id, 'watchlist');
      const hub = await makeHub(hubRepo);

      await expect(
        lists.addItem(list.id, b.id, { hubId: hub.id }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws NotFoundException for a hub that does not exist', async () => {
      const u = await makeUser(userRepo);
      const list = await defaultList(u.id, 'watchlist');
      await expect(
        lists.addItem(list.id, u.id, { hubId: '00000000-0000-0000-0000-000000000000' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('removeItem', () => {
    it('removes the row and decrements itemsCount', async () => {
      const u = await makeUser(userRepo);
      const list = await defaultList(u.id, 'watchlist');
      const hub = await makeHub(hubRepo);
      await lists.addItem(list.id, u.id, { hubId: hub.id });

      await lists.removeItem(list.id, hub.id, u.id);

      const refreshed = await listRepo.findOneByOrFail({ id: list.id });
      expect(refreshed.itemsCount).toBe(0);
      expect(await itemRepo.count({ where: { listId: list.id } })).toBe(0);
    });

    it('throws NotFoundException when the item is not on the list', async () => {
      const u = await makeUser(userRepo);
      const list = await defaultList(u.id, 'watchlist');
      const hub = await makeHub(hubRepo);
      await expect(
        lists.removeItem(list.id, hub.id, u.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects another user trying to remove from your list', async () => {
      const a = await makeUser(userRepo);
      const b = await makeUser(userRepo);
      const list = await defaultList(a.id, 'watchlist');
      const hub = await makeHub(hubRepo);
      await lists.addItem(list.id, a.id, { hubId: hub.id });

      await expect(
        lists.removeItem(list.id, hub.id, b.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('deleteList', () => {
    it('refuses to delete a default list', async () => {
      const u = await makeUser(userRepo);
      const list = await defaultList(u.id, 'watchlist');
      await expect(lists.deleteList(list.id, u.id)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('deletes a custom list owned by the user', async () => {
      const u = await makeUser(userRepo);
      const custom = await lists.createList(u.id, { name: 'Best of 2024' });
      await lists.deleteList(custom.id, u.id);
      const found = await listRepo.findOne({ where: { id: custom.id } });
      expect(found).toBeNull();
    });

    it('refuses to delete another user’s list', async () => {
      const a = await makeUser(userRepo);
      const b = await makeUser(userRepo);
      const custom = await lists.createList(a.id, { name: 'A’s list' });
      await expect(lists.deleteList(custom.id, b.id)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('getListItems (visibility)', () => {
    it('refuses to read someone else’s private list', async () => {
      const a = await makeUser(userRepo);
      const b = await makeUser(userRepo);
      const list = await defaultList(a.id, 'watchlist'); // not public
      await expect(lists.getListItems(list.id, b.id)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets a stranger read a public list', async () => {
      const a = await makeUser(userRepo);
      const b = await makeUser(userRepo);
      const list = await listRepo.save(
        listRepo.create({ userId: a.id, listType: 'custom', name: 'Public', isPublic: true }),
      );
      await expect(lists.getListItems(list.id, b.id)).resolves.toBeDefined();
    });
  });
});

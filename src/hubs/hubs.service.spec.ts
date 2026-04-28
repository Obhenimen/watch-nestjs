import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { HubsService } from './hubs.service';
import { Hub } from './entities/hub.entity';
import { HubFollow } from './entities/hub-follow.entity';
import { User } from '../users/entities/user.entity';
import { inMemoryDbConfig } from '../test-utils/test-db';
import { makeUser, makeHub } from '../test-utils/fixtures';

describe('HubsService', () => {
  let module: TestingModule;
  let hubs: HubsService;
  let userRepo: Repository<User>;
  let hubRepo: Repository<Hub>;
  let followRepo: Repository<HubFollow>;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(inMemoryDbConfig()),
        TypeOrmModule.forFeature([Hub, HubFollow, User]),
      ],
      providers: [HubsService],
    }).compile();

    hubs = module.get(HubsService);
    userRepo = module.get(getRepositoryToken(User));
    hubRepo = module.get(getRepositoryToken(Hub));
    followRepo = module.get(getRepositoryToken(HubFollow));
  });

  afterEach(async () => {
    await module.close();
  });

  describe('toggleFollow', () => {
    it('follow → unfollow keeps followersCount in sync with rows', async () => {
      const u = await makeUser(userRepo);
      const h = await makeHub(hubRepo);

      await hubs.toggleFollow(h.id, u.id);
      let refreshed = await hubRepo.findOneByOrFail({ id: h.id });
      expect(refreshed.followersCount).toBe(1);
      expect(await followRepo.count({ where: { hubId: h.id } })).toBe(1);

      await hubs.toggleFollow(h.id, u.id);
      refreshed = await hubRepo.findOneByOrFail({ id: h.id });
      expect(refreshed.followersCount).toBe(0);
      expect(await followRepo.count({ where: { hubId: h.id } })).toBe(0);
    });

    it('counter equals row count after multiple users follow / unfollow', async () => {
      const h = await makeHub(hubRepo);
      const a = await makeUser(userRepo);
      const b = await makeUser(userRepo);
      const c = await makeUser(userRepo);

      await hubs.toggleFollow(h.id, a.id);
      await hubs.toggleFollow(h.id, b.id);
      await hubs.toggleFollow(h.id, c.id);
      await hubs.toggleFollow(h.id, b.id); // b unfollows

      const refreshed = await hubRepo.findOneByOrFail({ id: h.id });
      const rows = await followRepo.count({ where: { hubId: h.id } });
      expect(refreshed.followersCount).toBe(rows);
      expect(refreshed.followersCount).toBe(2);
    });

    it('throws NotFoundException for an unknown hub', async () => {
      const u = await makeUser(userRepo);
      await expect(
        hubs.toggleFollow('00000000-0000-0000-0000-000000000000', u.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('sorts by trendingScore for the trending tab', async () => {
      await makeHub(hubRepo, { name: 'Low', trendingScore: 1 });
      await makeHub(hubRepo, { name: 'High', trendingScore: 100 });
      await makeHub(hubRepo, { name: 'Mid', trendingScore: 50 });

      const { hubs: result } = await hubs.findAll('trending', 10);
      expect(result.map((h) => h.name)).toEqual(['High', 'Mid', 'Low']);
    });

    it('sorts by followersCount for the top tab', async () => {
      await makeHub(hubRepo, { name: 'A', followersCount: 5 });
      await makeHub(hubRepo, { name: 'B', followersCount: 50 });
      const { hubs: result } = await hubs.findAll('top', 10);
      expect(result[0].name).toBe('B');
    });
  });

  describe('search', () => {
    it('returns case-insensitive substring matches', async () => {
      await makeHub(hubRepo, { name: 'The Matrix' });
      await makeHub(hubRepo, { name: 'Matrix Reloaded' });
      await makeHub(hubRepo, { name: 'Inception' });

      const { hubs: result } = await hubs.search('matrix');
      expect(result).toHaveLength(2);
    });
  });

  describe('findById', () => {
    it('reports followedByMe = true once the viewer follows the hub', async () => {
      const u = await makeUser(userRepo);
      const h = await makeHub(hubRepo);
      await hubs.toggleFollow(h.id, u.id);

      const seen = await hubs.findById(h.id, u.id);
      expect(seen.followedByMe).toBe(true);
    });

    it('reports followedByMe = false for non-followers', async () => {
      const u = await makeUser(userRepo);
      const h = await makeHub(hubRepo);
      const seen = await hubs.findById(h.id, u.id);
      expect(seen.followedByMe).toBe(false);
    });
  });
});

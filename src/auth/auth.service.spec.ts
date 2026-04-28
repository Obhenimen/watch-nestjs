import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { User } from '../users/entities/user.entity';
import { UserFollow } from '../users/entities/user-follow.entity';
import { List } from '../lists/entities/list.entity';
import { Post } from '../posts/entities/post.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { inMemoryDbConfig } from '../test-utils/test-db';

describe('AuthService', () => {
  let module: TestingModule;
  let auth: AuthService;
  let users: UsersService;
  let tokenRepo: Repository<PasswordResetToken>;

  const validSignup = {
    email: 'alice@test.local',
    password: 'verysecret',
    username: 'alice',
    displayName: 'Alice',
  };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(inMemoryDbConfig()),
        TypeOrmModule.forFeature([User, UserFollow, List, Post, Notification, PasswordResetToken]),
        JwtModule.register({ secret: 'test-secret', signOptions: { expiresIn: '1h' } }),
      ],
      providers: [AuthService, UsersService, NotificationsService],
    }).compile();

    auth = module.get(AuthService);
    users = module.get(UsersService);
    tokenRepo = module.get(getRepositoryToken(PasswordResetToken));
  });

  afterEach(async () => {
    await module.close();
  });

  describe('signup', () => {
    it('creates a user, returns an access token, and provisions default lists', async () => {
      const result = await auth.signup(validSignup);
      expect(result.accessToken).toBeTruthy();
      expect(result.user.email).toBe(validSignup.email);
      // Defaults: watchlist + watched + favorites
      const lists = await module.get<Repository<List>>(getRepositoryToken(List)).find({
        where: { userId: result.user.id },
      });
      expect(lists).toHaveLength(3);
      expect(lists.map((l) => l.listType).sort()).toEqual(['favorites', 'watched', 'watchlist']);
    });

    it('rejects duplicate emails', async () => {
      await auth.signup(validSignup);
      await expect(
        auth.signup({ ...validSignup, username: 'alice2' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects duplicate usernames', async () => {
      await auth.signup(validSignup);
      await expect(
        auth.signup({ ...validSignup, email: 'alice2@test.local' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('persists the password as a bcrypt hash, never the raw value', async () => {
      const result = await auth.signup(validSignup);
      const stored = await users.findByEmailWithPassword(result.user.email);
      expect(stored?.passwordHash).not.toBe(validSignup.password);
      expect(stored?.passwordHash.startsWith('$2')).toBe(true);
    });
  });

  describe('login', () => {
    it('returns an access token for valid credentials', async () => {
      await auth.signup(validSignup);
      const result = await auth.login({ email: validSignup.email, password: validSignup.password });
      expect(result.accessToken).toBeTruthy();
    });

    it('rejects an unknown email', async () => {
      await expect(
        auth.login({ email: 'nobody@test.local', password: 'whatever' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a wrong password', async () => {
      await auth.signup(validSignup);
      await expect(
        auth.login({ email: validSignup.email, password: 'wrongwrongwrong' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('forgot/reset password', () => {
    it('invalidates previously issued tokens when a new one is requested', async () => {
      const { user } = await auth.signup(validSignup);
      const first = await auth.forgotPassword({ email: validSignup.email });
      await auth.forgotPassword({ email: validSignup.email });

      const tokens = await tokenRepo.find({ where: { userId: user.id } });
      const usedCount = tokens.filter((t) => t.used).length;
      expect(usedCount).toBeGreaterThanOrEqual(1);
      expect(first.resetToken).toBeTruthy();
    });

    it('does not reveal whether an email is registered (forgot returns the same message)', async () => {
      const a = await auth.forgotPassword({ email: 'noone@test.local' });
      await auth.signup(validSignup);
      const b = await auth.forgotPassword({ email: validSignup.email });
      expect(a.message).toEqual(b.message);
      // Only the registered case includes a token (b), not a (this is leaky in dev — flagged for prod)
      expect((a as { resetToken?: string }).resetToken).toBeUndefined();
      expect(b.resetToken).toBeTruthy();
    });

    it('resets the password with a valid token', async () => {
      await auth.signup(validSignup);
      const { resetToken } = await auth.forgotPassword({ email: validSignup.email });
      await auth.resetPassword({ token: resetToken!, newPassword: 'brandnewpass' });

      // Old password no longer works
      await expect(
        auth.login({ email: validSignup.email, password: validSignup.password }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      // New password works
      const result = await auth.login({ email: validSignup.email, password: 'brandnewpass' });
      expect(result.accessToken).toBeTruthy();
    });

    it('rejects a fabricated/unknown token', async () => {
      await auth.signup(validSignup);
      await expect(
        auth.resetPassword({ token: 'totally-fake-token', newPassword: 'newpass1234' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a token after it has been used once', async () => {
      await auth.signup(validSignup);
      const { resetToken } = await auth.forgotPassword({ email: validSignup.email });
      await auth.resetPassword({ token: resetToken!, newPassword: 'firstreset' });
      await expect(
        auth.resetPassword({ token: resetToken!, newPassword: 'secondreset' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects an expired token', async () => {
      const { user } = await auth.signup(validSignup);
      // Insert a token that's already expired.
      const raw = 'manuallyinjectedrawtoken';
      const tokenHash = await bcrypt.hash(raw, 10);
      await tokenRepo.save(
        tokenRepo.create({
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() - 1000),
          used: false,
        }),
      );
      await expect(
        auth.resetPassword({ token: raw, newPassword: 'newpassword' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
